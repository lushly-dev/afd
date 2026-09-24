/**
 * Shared run loop behaviour, exercised through both executors: timeouts and
 * cancellation, fixtures, unresolved step references, unsupported fields.
 */

import { chmodSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandResult } from '@lushly-dev/afd-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scenario } from '../types/scenario.js';
import { type CommandHandler, InProcessExecutor, ScenarioExecutor } from './executor.js';
import { createTimeoutReason, determineOutcome } from './scenario-runner.js';

const cliFixturePath = join(
	dirname(fileURLToPath(import.meta.url)),
	'fixtures',
	'fake-afd-cli.mjs'
);

beforeAll(() => chmodSync(cliFixturePath, 0o755));

function scenario(overrides: Partial<Scenario> = {}): Scenario {
	return {
		name: 'Runner',
		description: 'Runner behaviour',
		job: 'runner',
		tags: [],
		steps: [
			{ command: 'step-one', expect: { success: true } },
			{ command: 'step-two', expect: { success: true } },
		],
		...overrides,
	};
}

const ok = (data: unknown = {}): CommandResult<unknown> => ({ success: true, data });

describe('scenario timeout and cancellation', () => {
	it('stops a timed-out scenario: no later step runs and the error is recorded', async () => {
		const calls: string[] = [];
		let signalSeen: AbortSignal | undefined;
		const handler: CommandHandler = async (command, _input, context) => {
			calls.push(command);
			if (command === 'slow-step') {
				signalSeen = context?.signal;
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			return ok();
		};

		const result = await new InProcessExecutor({ handler }).execute(
			scenario({
				timeout: 30,
				steps: [
					{ command: 'slow-step', expect: { success: true } },
					{ command: 'mutating-step', expect: { success: true } },
				],
			})
		);
		// Give the abandoned slow step time to finish: the next step must still not run
		await new Promise((resolve) => setTimeout(resolve, 250));

		expect(result.outcome).toBe('error');
		expect(result.error).toEqual({ type: 'timeout', message: 'Scenario timed out after 30ms' });
		expect(result.stepResults.map((s) => [s.outcome, s.error?.type])).toEqual([
			['error', 'timeout'],
			['skip', undefined],
		]);
		expect(result.stepResults[1]?.skippedReason).toBe('Scenario timed out after 30ms');
		expect(calls).toEqual(['slow-step']);
		expect(signalSeen?.aborted).toBe(true);
	});

	it('cancels through the caller signal between steps', async () => {
		const controller = new AbortController();
		const handler = vi.fn(async () => ok());

		const result = await new InProcessExecutor({
			handler,
			onStepComplete: () => controller.abort(new Error('user cancelled')),
		}).execute(scenario(), { signal: controller.signal });

		expect(result.outcome).toBe('error');
		expect(result.error).toEqual({ type: 'aborted', message: 'Scenario aborted: user cancelled' });
		expect(result.stepResults.map((s) => s.outcome)).toEqual(['pass', 'skip']);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('abandons the running step when cancelled during it', async () => {
		const controller = new AbortController();
		const handler: CommandHandler = async () => {
			controller.abort();
			return ok();
		};

		const result = await new InProcessExecutor({ handler }).execute(scenario(), {
			signal: controller.signal,
		});

		expect(result.stepResults.map((s) => [s.outcome, s.error?.type])).toEqual([
			['error', 'unknown'],
			['skip', undefined],
		]);
		expect(result.error?.message).toContain('Scenario aborted');
	});

	it('does nothing when the signal is already aborted', async () => {
		const handler = vi.fn(async () => ok());
		const controller = new AbortController();
		controller.abort();

		const result = await new InProcessExecutor({ handler }).execute(scenario(), {
			signal: controller.signal,
		});

		expect(handler).not.toHaveBeenCalled();
		expect(result.error?.type).toBe('aborted');
		expect(result.skippedSteps).toBe(2);
	});

	it('classifies AbortSignal.timeout and createTimeoutReason as timeouts', async () => {
		const handler: CommandHandler = async () => ok();

		for (const reason of [
			createTimeoutReason(5),
			AbortSignal.abort(createTimeoutReason(7)).reason,
		]) {
			const controller = new AbortController();
			controller.abort(reason);
			const result = await new InProcessExecutor({ handler }).execute(scenario(), {
				signal: controller.signal,
			});
			expect(result.error?.type).toBe('timeout');
		}
	});

	it('clears the scenario timer when the scenario finishes first', async () => {
		vi.useFakeTimers();
		try {
			const result = await new InProcessExecutor({ handler: async () => ok() }).execute(
				scenario({ timeout: 60_000 })
			);

			expect(result.outcome).toBe('pass');
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('kills a hanging CLI step when the scenario times out', async () => {
		const executor = new ScenarioExecutor({
			cliPath: cliFixturePath,
			serverUrl: 'http://test.example/mcp',
			transport: 'http',
		});
		const started = Date.now();

		const result = await executor.execute(
			scenario({
				timeout: 300,
				steps: [{ command: 'hang', input: { wait: true }, expect: { success: true } }],
			})
		);

		expect(result.error?.type).toBe('timeout');
		expect(result.stepResults[0]?.error?.type).toBe('timeout');
		expect(Date.now() - started).toBeLessThan(5000);
	});
});

describe('unsupported and invalid scenario fields', () => {
	it.each([
		['verify', { verify: { assertions: ['all done'] } }],
		['isolation', { isolation: 'chained' as const }],
		['dependsOn', { dependsOn: ['other'] }],
	])('reports %s as unsupported instead of passing without it', async (field, extra) => {
		const handler = vi.fn(async () => ok());

		const result = await new InProcessExecutor({ handler }).execute(scenario(extra));

		expect(result.outcome).toBe('error');
		expect(result.error?.type).toBe('unsupported');
		expect(result.error?.message).toContain(`'${field}' is not supported`);
		expect(handler).not.toHaveBeenCalled();
	});

	it('reports a non-positive timeout', async () => {
		const result = await new InProcessExecutor({ handler: async () => ok() }).execute(
			scenario({ timeout: 0 })
		);

		expect(result.error).toEqual({
			type: 'unsupported',
			message: "'timeout' must be a positive number of milliseconds",
		});
	});
});

describe('step references', () => {
	it('errors on a reference that does not resolve instead of sending an empty value', async () => {
		const inputs: unknown[] = [];
		const handler: CommandHandler = async (_command, input) => {
			inputs.push(input);
			return ok({ id: 'abc' });
		};

		const result = await new InProcessExecutor({ handler, stopOnFailure: false }).execute(
			scenario({
				steps: [
					{ command: 'item-create', expect: { success: true } },
					{
						command: 'item-get',
						input: { id: '${{ steps[0].data.missing }}' },
						expect: { success: true },
					},
					{
						command: 'item-rename',
						input: { name: 'copy of ${{ steps[0].data.nothing }}' },
						expect: { success: true },
					},
					{
						command: 'item-delete',
						input: { id: '${{ steps[9].data.id }}' },
						expect: { success: true },
					},
				],
			})
		);

		expect(result.stepResults.map((s) => [s.outcome, s.error?.type])).toEqual([
			['pass', undefined],
			['error', 'reference_error'],
			['error', 'reference_error'],
			['error', 'reference_error'],
		]);
		expect(result.stepResults[1]?.error?.message).toContain(
			"steps[0] has no value at 'data.missing'"
		);
		expect(result.stepResults[3]?.error?.message).toContain('step 9 has not run');
		// Only the first step reached the handler
		expect(inputs).toEqual([undefined]);
	});

	it('resolves references through the CLI executor too', async () => {
		const executor = new ScenarioExecutor({
			cliPath: cliFixturePath,
			serverUrl: 'http://test.example/mcp',
			transport: 'http',
		});

		const result = await executor.execute(
			scenario({
				steps: [
					{ command: 'seed', input: { id: 'abc-1' }, expect: { success: true } },
					{
						command: 'echo',
						input: { ref: '${{ steps[0].data.id }}', label: 'id=${{ steps[0].data.id }}' },
						expect: { success: true, data: { ref: 'abc-1', label: 'id=abc-1' } },
					},
				],
			})
		);

		expect(result.outcome).toBe('pass');
	});
});

describe('fixtures', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'afd-runner-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('applies fixtures through the CLI and fails at the fixture step on a failed command', async () => {
		// The fake CLI expects a positional JSON input on every call
		const input = { n: 1 };
		const steps = [{ command: 'step-one', input, expect: { success: true } }];
		await writeFile(join(dir, 'ok.json'), JSON.stringify({ setup: [{ command: 'seed', input }] }));
		await writeFile(
			join(dir, 'bad.json'),
			JSON.stringify({
				setup: [
					{ command: 'fail-command', input },
					{ command: 'seed', input },
				],
			})
		);
		const executor = new ScenarioExecutor({
			cliPath: cliFixturePath,
			serverUrl: 'http://test.example/mcp',
			transport: 'http',
			basePath: dir,
		});

		const passing = await executor.execute(scenario({ steps, fixture: { file: 'ok.json' } }));
		const failing = await executor.execute(scenario({ steps, fixture: { file: 'bad.json' } }));
		const missing = await executor.execute(scenario({ steps, fixture: { file: 'none.json' } }));

		expect(passing.outcome).toBe('pass');
		expect(failing.outcome).toBe('error');
		expect(failing.error?.message).toBe(
			"Fixture command 'fail-command' failed with EXPECTED_FAILURE: Expected failure"
		);
		expect(failing.stepResults.every((s) => s.outcome === 'skip')).toBe(true);
		expect(missing.error?.message).toContain('Fixture failed to load');
	});

	it('resolves fixtures next to the scenario file, not the working directory', async () => {
		await writeFile(join(dir, 'seed.json'), JSON.stringify({ setup: [{ command: 'seed-it' }] }));
		const handler = vi.fn(async () => ok());

		const result = await new InProcessExecutor({ handler, basePath: '/nowhere' }).execute(
			scenario({ fixture: { file: './seed.json' }, sourcePath: join(dir, 'a.scenario.yaml') })
		);

		expect(result.outcome).toBe('pass');
		expect(handler).toHaveBeenCalledWith('seed-it', {}, expect.anything());
	});

	it('reports adapter warnings on the result and to onFixtureLoaded', async () => {
		await writeFile(join(dir, 'seed.json'), JSON.stringify({ setup: [{ nope: true }] }));
		const onFixtureLoaded = vi.fn();

		const result = await new InProcessExecutor({
			handler: async () => ok(),
			basePath: dir,
			onFixtureLoaded,
		}).execute(scenario({ fixture: { file: 'seed.json' } }));

		expect(result.warnings).toEqual(["Skipped a fixture entry without a string 'command'"]);
		expect(onFixtureLoaded).toHaveBeenCalledWith(expect.anything(), [], result.warnings);
	});

	it('only loads the fixture in a dry run', async () => {
		await writeFile(join(dir, 'seed.json'), JSON.stringify({ setup: [{ command: 'seed' }] }));
		const handler = vi.fn(async () => ok());

		const dry = await new InProcessExecutor({ handler, basePath: dir, dryRun: true }).execute(
			scenario({ fixture: { file: 'seed.json' } })
		);
		const dryMissing = await new InProcessExecutor({
			handler,
			basePath: dir,
			dryRun: true,
		}).execute(scenario({ fixture: { file: 'none.json' } }));

		expect(dry.outcome).toBe('pass');
		expect(handler).not.toHaveBeenCalled();
		expect(dryMissing.error?.message).toContain('Fixture validation failed');
	});

	it('confines fixtures to fixtureRoot', async () => {
		const handler = vi.fn(async () => ok());

		const result = await new InProcessExecutor({ handler, fixtureRoot: dir }).execute(
			scenario({ fixture: { file: '../../etc/passwd' }, sourcePath: join(dir, 'a.scenario.yaml') })
		);

		expect(result.error?.type).toBe('fixture_failed');
		expect(result.error?.message).toContain('outside the allowed directory');
		expect(handler).not.toHaveBeenCalled();
	});
});

describe('invalid expectations and outcomes', () => {
	it('reports a malformed expectation as a step error, not a pass', async () => {
		const result = await new InProcessExecutor({ handler: async () => ok({ user: {} }) }).execute(
			scenario({
				steps: [
					{
						command: 'user-get',
						expect: { success: true, data: { user: { exists: true, name: 'Bob' } } },
					},
				],
			})
		);

		expect(result.stepResults[0]?.outcome).toBe('error');
		expect(result.stepResults[0]?.error?.type).toBe('parse_error');
	});

	it('determines outcomes from step counts', () => {
		expect(determineOutcome(2, 0, 0)).toBe('pass');
		expect(determineOutcome(0, 1, 1)).toBe('fail');
		expect(determineOutcome(1, 1, 0)).toBe('partial');
		expect(determineOutcome(1, 0, 1)).toBe('fail');
	});
});
