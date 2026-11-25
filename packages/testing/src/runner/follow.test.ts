/**
 * `follow` on a refused step: the runner takes the step the refusal's `error.recovery` describes
 * (`spec/recovery.md`) and fails the step unless that gets further.
 */

import type { CommandError, CommandResult, Recovery } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { parseScenarioString } from '../parsers/yaml.js';
import type { Scenario } from '../types/scenario.js';
import { type CommandHandler, InProcessExecutor, validateScenario } from './executor.js';

/**
 * A tiny world: `claim` refuses a held item with a given recovery; `list` lists free items;
 * `resume` unpauses; `claim` of a free item while unpaused succeeds. With `busy`, the first that
 * many claims are refused as BUSY; with `cause`, a refusal carries it.
 */
function world(
	recovery: Recovery | undefined,
	options: { paused?: boolean; busy?: number; cause?: CommandError } = {}
) {
	const state = {
		paused: options.paused ?? false,
		busy: options.busy ?? 0,
		held: new Set(['a']),
		calls: [] as string[],
	};
	const handler: CommandHandler = async (command, input) => {
		state.calls.push(command);
		const item = String((input as { item?: string } | undefined)?.item ?? '');
		if (command === 'list') return { success: true, data: { free: ['b'] } };
		if (command === 'resume') {
			state.paused = false;
			return { success: true, data: {} };
		}
		if (command === 'claim') {
			if (state.busy > 0 || state.paused || state.held.has(item) || item === '') {
				const code = state.busy > 0 ? 'BUSY' : state.paused ? 'PAUSED' : 'HELD';
				state.busy = Math.max(0, state.busy - 1);
				return {
					success: false,
					error: {
						code,
						message: 'Refused',
						suggestion: 'Follow the recovery',
						...(recovery ? { recovery } : {}),
						...(options.cause ? { cause: options.cause } : {}),
					},
				} satisfies CommandResult<unknown>;
			}
			state.held.add(item);
			return { success: true, data: { item } };
		}
		return { success: false, error: { code: 'COMMAND_NOT_FOUND', message: command } };
	};
	return { handler, state };
}

function refused(follow: Scenario['steps'][number]['follow'], item = 'a'): Scenario {
	return {
		name: 'Follow',
		description: 'Follow a refusal',
		job: 'follow',
		tags: [],
		steps: [{ command: 'claim', input: { item }, expect: { success: false }, follow }],
	};
}

async function run(recovery: Recovery | undefined, scenario: Scenario, paused = false) {
	const w = world(recovery, { paused });
	const result = await new InProcessExecutor({ handler: w.handler }).execute(scenario);
	return { result, step: result.stepResults[0], calls: w.state.calls };
}

describe('follow', () => {
	it('calls the recovery command and passes when it succeeds', async () => {
		const { step, calls } = await run({ kind: 'call', command: 'list' }, refused({}));
		expect(step?.outcome).toBe('pass');
		expect(calls).toEqual(['claim', 'list']);
		expect(step?.follow?.map((s) => s.command)).toEqual(['list']);
	});

	it('judges the recovery call by follow.expect', async () => {
		const pass = await run(
			{ kind: 'call', command: 'list' },
			refused({ expect: { success: true, data: { free: ['b'] } } })
		);
		expect(pass.step?.outcome).toBe('pass');
		const fail = await run(
			{ kind: 'call', command: 'list' },
			refused({ expect: { success: true, data: { free: ['c'] } } })
		);
		expect(fail.step?.outcome).toBe('fail');
		expect(fail.step?.error?.message).toMatch(/^follow: list/);
	});

	it('repeats the refused call after a thenRetry recovery and fails if it refuses again', async () => {
		const resumes = await run(
			{ kind: 'call', command: 'resume', thenRetry: true },
			refused({}, 'b'),
			true
		);
		expect(resumes.step?.outcome).toBe('pass');
		expect(resumes.calls).toEqual(['claim', 'resume', 'claim']);

		// A recovery that does not fix the refusal leads straight back to it.
		const wrong = await run(
			{ kind: 'call', command: 'list', thenRetry: true },
			refused({}, 'b'),
			true
		);
		expect(wrong.step?.outcome).toBe('fail');
		expect(wrong.step?.error?.message).toBe('follow: claim came back with the same PAUSED refusal');
		expect(wrong.step?.follow?.map((s) => s.command)).toEqual(['list', 'claim']);
	});

	it('repeats the command with the fixed input, and refuses one it cannot complete', async () => {
		const fixed = await run({ kind: 'fix-input', input: { item: 'b' } }, refused({}));
		expect(fixed.step?.outcome).toBe('pass');
		const chosen = await run(
			{ kind: 'fix-input', needs: ['item'] },
			refused({ input: { item: 'b' } })
		);
		expect(chosen.step?.outcome).toBe('pass');
		const unchosen = await run({ kind: 'fix-input', needs: ['item'] }, refused({}));
		expect(unchosen.step?.outcome).toBe('fail');
		expect(unchosen.step?.error?.message).toBe(
			'follow: the recovery needs item; give it in follow.input'
		);
		expect(unchosen.calls).toEqual(['claim']);
	});

	it('fails a retry that comes back with the same refusal', async () => {
		const { step } = await run({ kind: 'retry' }, refused({}));
		expect(step?.outcome).toBe('fail');
		expect(step?.error?.message).toBe('follow: claim came back with the same HELD refusal');
	});

	it('has nothing to follow without a recovery, or with an external or stop one', async () => {
		for (const [recovery, message] of [
			[undefined, 'follow: the HELD refusal carries no recovery to follow'],
			[{ kind: 'stop' }, /stop recovery has nothing a program can follow/],
			[{ kind: 'external' }, /external recovery has nothing/],
			[
				{ kind: 'teleport' } as unknown as Recovery,
				"follow: the HELD refusal's recovery is unreadable",
			],
		] as const) {
			const { step, calls } = await run(recovery as Recovery | undefined, refused({}));
			expect(step?.outcome).toBe('fail');
			if (typeof message === 'string') expect(step?.error?.message).toBe(message);
			else expect(step?.error?.message).toMatch(message);
			expect(calls).toEqual(['claim']);
		}
	});

	it('reads a recovery exactly as a client does (rule 7)', async () => {
		for (const recovery of [
			{ kind: 'fix-input', input: { confirm: true, item: 'b' } },
			{ kind: 'fix-input' },
			{ kind: 'fix-input', input: 'b' },
			{ kind: 'fix-input', needs: [1] },
			{ kind: 'call', command: '' },
			{ kind: 'call', command: 'resume', thenRetry: 'yes' },
			{ kind: 'call', command: 'resume', then_retry: true },
			{ kind: 'call', command: 'list', input: null },
			{ kind: 'stop', reason: 'x' },
		]) {
			const { step, calls } = await run(
				recovery as unknown as Recovery,
				refused({ input: { item: 'b' } })
			);
			expect(step?.error?.message, JSON.stringify(recovery)).toBe(
				"follow: the HELD refusal's recovery is unreadable"
			);
			expect(calls).toEqual(['claim']);
		}
	});

	it('refuses a recovery that both sets and needs a field (rule 3)', async () => {
		const { step, calls } = await run(
			{ kind: 'fix-input', input: { item: 'b' }, needs: ['item'] },
			refused({ input: { item: 'b' } })
		);
		expect(step?.error?.message).toBe('follow: the recovery names item in both input and needs');
		expect(calls).toEqual(['claim']);
	});

	it('takes from follow.input only what the recovery leaves to the caller', async () => {
		// A wrong recovery stays wrong: the scenario cannot overwrite what it says.
		const { step, calls } = await run(
			{ kind: 'fix-input', input: { item: 'a' } },
			refused({ input: { item: 'b' } })
		);
		expect(step?.error?.message).toBe(
			'follow: follow.input gives item, which the recovery does not leave to the caller'
		);
		expect(calls).toEqual(['claim']);
	});

	it('fails a same refusal even when follow.expect expects it', async () => {
		const { step } = await run(
			{ kind: 'retry' },
			refused({ expect: { success: false, error: { code: 'HELD' } } })
		);
		expect(step?.outcome).toBe('fail');
		expect(step?.error?.message).toBe('follow: claim came back with the same HELD refusal');
	});

	it('passes a retry when the repeated call gets through', async () => {
		const w = world({ kind: 'retry' }, { busy: 1 });
		const result = await new InProcessExecutor({ handler: w.handler }).execute(refused({}, 'b'));
		expect(result.stepResults[0]?.outcome).toBe('pass');
		expect(w.state.calls).toEqual(['claim', 'claim']);
	});

	it('reads a null recovery as none, as the Python runner does', async () => {
		const result = await new InProcessExecutor({
			handler: async () =>
				({
					success: false,
					error: { code: 'HELD', message: 'Refused', recovery: null },
				}) as unknown as CommandResult<unknown>,
		}).execute(refused({}));
		expect(result.stepResults[0]?.error?.message).toBe(
			'follow: the HELD refusal carries no recovery to follow'
		);
	});

	it("never follows a cause's recovery (rule 8)", async () => {
		const w = world(undefined, {
			cause: { code: 'INNER', message: 'x', recovery: { kind: 'call', command: 'list' } },
		});
		const result = await new InProcessExecutor({ handler: w.handler }).execute(refused({}));
		expect(result.stepResults[0]?.error?.message).toBe(
			'follow: the HELD refusal carries no recovery to follow'
		);
		expect(w.state.calls).toEqual(['claim']);
	});

	it('refuses follow.retry without a thenRetry call', async () => {
		const { step, calls } = await run(
			{ kind: 'call', command: 'list' },
			refused({ retry: { success: true } })
		);
		expect(step?.error?.message).toBe(
			"follow: 'follow.retry' needs a call recovery with thenRetry"
		);
		expect(calls).toEqual(['claim']);
	});

	it('resolves step references in follow.input', async () => {
		const w = world({ kind: 'fix-input', needs: ['item'] });
		const result = await new InProcessExecutor({ handler: w.handler }).execute({
			name: 'Follow',
			description: 'Follow with a value from an earlier step',
			job: 'follow',
			tags: [],
			steps: [
				{ command: 'list', expect: { success: true } },
				{
					command: 'claim',
					input: { item: 'a' },
					expect: { success: false },
					follow: { input: { item: '${{ steps[0].data.free[0] }}' } },
				},
			],
		});
		expect(result.stepResults[1]?.outcome, result.stepResults[1]?.error?.message).toBe('pass');
		expect([...w.state.held]).toEqual(['a', 'b']);
	});

	it('is checked by validateScenario in a scenario built in code', async () => {
		const scenario = refused({
			input: { item: '${{ steps[0].data.x }}' },
			// 'data' is only checked on a success
			expect: { success: false, data: { free: ['b'] } },
		});
		const [first] = scenario.steps;
		if (!first) throw new Error('the scenario has a step');
		scenario.steps[0] = { ...first, expect: { success: true } };
		const { errors } = await validateScenario(scenario);
		expect(errors).toContain(
			"Step 1 'follow' needs a refusal to follow: set 'expect.success' to false"
		);
		expect(errors.some((e) => e.startsWith("Step 1 'follow.expect': "))).toBe(true);
		expect(errors).toContain(
			'Step 1: Invalid reference to step 0 (can only reference earlier steps)'
		);
	});

	it('does not follow a step whose own expectation failed', async () => {
		const scenario = refused({});
		const [first] = scenario.steps;
		if (!first) throw new Error('the scenario has a step');
		scenario.steps[0] = { ...first, expect: { success: true } };
		const { step, calls } = await run({ kind: 'call', command: 'list' }, scenario);
		expect(step?.outcome).toBe('fail');
		expect(step?.follow).toBeUndefined();
		expect(calls).toEqual(['claim']);
	});
});

describe('follow and error.recovery in YAML', () => {
	const yaml = (follow: string, recovery = '{ kind: call, command: list }') => `
name: Follow
description: Follow a refusal
job: follow
steps:
  - command: claim
    input: { item: a }
    expect:
      success: false
      error:
        code: HELD
        recovery: ${recovery}
    follow:${follow}
`;

	it('parses follow and checks error.recovery like data', async () => {
		const parsed = parseScenarioString(yaml(' { expect: { success: true, data: { free: [b] } } }'));
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		const ok = await new InProcessExecutor({
			handler: world({ kind: 'call', command: 'list' }).handler,
		}).execute(parsed.scenario);
		expect(ok.outcome).toBe('pass');
		const wrong = await new InProcessExecutor({
			handler: world({ kind: 'call', command: 'resume' }).handler,
		}).execute(parsed.scenario);
		expect(wrong.stepResults[0]?.outcome).toBe('fail');
		expect(wrong.stepResults[0]?.assertions.find((a) => !a.passed)?.path).toBe(
			'error.recovery.command'
		);
		const none = await new InProcessExecutor({ handler: world(undefined).handler }).execute(
			parsed.scenario
		);
		expect(none.stepResults[0]?.assertions.find((a) => !a.passed)?.path).toBe('error.recovery');
	});

	it('fails error.recovery on a recovery no reader keeps, and on a null one', async () => {
		const parsed = parseScenarioString(yaml(' true'));
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		const bogus = await new InProcessExecutor({
			handler: world({ kind: 'call', command: 'list', bogus: 1 } as unknown as Recovery).handler,
		}).execute(parsed.scenario);
		expect(
			bogus.stepResults[0]?.assertions.filter((a) => !a.passed).map((a) => [a.path, a.matcher])
		).toEqual([['error.recovery', 'readable']]);
		// The message says why, not just "expected X, got Y" for values that look alike.
		expect(bogus.stepResults[0]?.error?.message).toMatch(
			/^error\.recovery is unreadable: it breaks \$defs\/recovery/
		);
		const nulled = await new InProcessExecutor({
			// A null member is never sent, but a reader must survive one.
			handler: async () =>
				({
					success: false,
					error: { code: 'HELD', message: 'Refused', recovery: null },
				}) as unknown as CommandResult<unknown>,
		}).execute(parsed.scenario);
		expect(
			nulled.stepResults[0]?.assertions.filter((a) => !a.passed).map((a) => [a.path, a.matcher])
		).toEqual([['error.recovery', 'exists']]);
	});

	it('names follow.expect and follow.retry in their parse errors', () => {
		const noSuccess = parseScenarioString(yaml(' { expect: { data: {} } }'));
		expect(noSuccess.success).toBe(false);
		if (!noSuccess.success) {
			expect(noSuccess.error).toContain(
				"Step 1 'follow.expect' must have a boolean 'success' field"
			);
		}
		const retry = parseScenarioString(yaml(' { retry: 3 }'));
		expect(retry.success).toBe(false);
		if (!retry.success) expect(retry.error).toContain("Step 1 'follow.retry' must be an object");
	});

	it('accepts follow: true and refuses follow on an expected success or with unknown keys', () => {
		expect(parseScenarioString(yaml(' true')).success).toBe(true);
		const onSuccess = parseScenarioString(
			yaml(' true')
				.replace('success: false', 'success: true')
				.replace(/ {6}error:[\s\S]*?\n {4}follow/, '    follow')
		);
		expect(onSuccess.success).toBe(false);
		expect(parseScenarioString(yaml(' { expct: { success: true } }')).success).toBe(false);
		expect(parseScenarioString(yaml(' true', '[call]')).success).toBe(false);
	});
});
