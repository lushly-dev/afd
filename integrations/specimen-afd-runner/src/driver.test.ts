import type { CommandResult } from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core/result';
import type {
	JobDriverHost,
	JobScenario,
	ResolvedJobCapture,
	SpecimenEntry,
} from '@lushly-dev/specimen';
import { describe, expect, it, vi } from 'vitest';
import { createAfdJobDriver } from './driver.js';

type CaptureRequest = Parameters<JobDriverHost['captureStep']>[0];

function createMockHost(options: {
	scenario: JobScenario;
	capturePlan?: ResolvedJobCapture[];
	entry?: Partial<SpecimenEntry>;
	signal?: AbortSignal;
	runCommand?: (
		runner: string,
		target: string,
		name: string,
		input: unknown
	) => Promise<unknown> | unknown;
	runActions?: (actions: readonly { action: Record<string, unknown> }[]) => Promise<number>;
	captureStep?: (request: CaptureRequest) => Promise<{ screenshot: string | null }>;
}) {
	const events: string[] = [];
	const captures: CaptureRequest[] = [];
	const commands: Array<{ runner: string; target: string; name: string; input: unknown }> = [];
	const controller = new AbortController();
	const entry: SpecimenEntry = {
		id: 'notes-keep-a-draft',
		title: 'Notes/Keep a draft',
		module: './app.specimens.ts',
		exportName: 'NotesApp',
		job: {
			scenario: './scenarios/keep-a-draft.scenario.yaml',
			target: 'app',
			captures: [],
		},
		...options.entry,
	};

	const host: JobDriverHost = {
		element: {} as Element,
		targets: {},
		entry,
		context: {
			viewport: { width: 1280, height: 720 },
			theme: 'light',
			locale: 'en-US',
			motion: 'settled',
			reducedMotion: 'no-preference',
		},
		scenario: options.scenario,
		capturePlan: options.capturePlan ?? [],
		signal: options.signal ?? controller.signal,
		async runCommand(runner, target, name, input) {
			events.push(`command:${name}`);
			commands.push({ runner, target, name, input });
			if (options.runCommand) {
				return await options.runCommand(runner, target, name, input);
			}
			return success({ name, input });
		},
		async runActions(actions) {
			events.push(`actions:${actions.length}`);
			if (options.runActions) {
				return await options.runActions(actions);
			}
			return actions.length;
		},
		async captureStep(request) {
			events.push(`capture:${request.key}`);
			captures.push(request);
			if (options.captureStep) {
				return await options.captureStep(request);
			}
			return { screenshot: null };
		},
		advanceClock: vi.fn(),
	};

	return { host, controller, events, captures, commands };
}

describe('createAfdJobDriver', () => {
	it('applies fixtures, resolves step references, awaits before/after hooks, and captures passing steps', async () => {
		const { host, events, captures, commands } = createMockHost({
			scenario: {
				job: 'keep-a-draft',
				name: 'Keep a draft',
				fixture: {
					app: 'custom',
					setup: [{ command: 'note-seed', input: { workspace: 'team-vault' } }],
				},
				steps: [
					{
						step: 1,
						description: 'Create note',
						command: 'note-create',
						input: { title: 'Quarterly plan' },
						expect: { success: true, data: { id: 'note-1' } },
					},
					{
						step: 2,
						description: 'Save external change',
						command: 'note-save-external',
						input: { id: '${{ steps[0].data.id }}', body: 'Remote' },
						expect: { success: true, data: { conflict: true } },
					},
				],
			},
			capturePlan: [
				{
					key: 'notes-keep-a-draft/2',
					name: 'conflict-notice',
					step: 2,
					after: 'Save external change',
					before: [{ action: { fill: 'draft', value: 'unsaved' } }],
				},
			],
			async runCommand(_runner, _target, name, input) {
				if (name === 'note-seed') return success({ workspace: 'team-vault' });
				if (name === 'note-create') return success({ id: 'note-1', input });
				if (name === 'note-save-external') return success({ id: 'note-1', conflict: true });
				return failure({ code: 'UNKNOWN', message: name });
			},
		});

		const driver = createAfdJobDriver();
		const result = await driver.run(host);

		expect(result.status).toBe('passed');
		expect(result.steps).toEqual([
			{
				step: 1,
				description: 'Create note',
				command: 'note-create',
				status: 'passed',
			},
			{
				step: 2,
				description: 'Save external change',
				command: 'note-save-external',
				status: 'passed',
				actions: 1,
			},
		]);
		expect(events).toEqual([
			'command:note-seed',
			'command:note-create',
			'actions:1',
			'command:note-save-external',
			'capture:notes-keep-a-draft/2',
		]);
		expect(commands[2]).toEqual({
			runner: 'afd',
			target: 'app',
			name: 'note-save-external',
			input: { id: 'note-1', body: 'Remote' },
		});
		expect(captures).toEqual([
			{
				key: 'notes-keep-a-draft/2',
				name: 'conflict-notice',
				step: 2,
				description: 'Save external change',
				actions: 1,
			},
		]);
	});

	it('evaluates structured CommandResult failure expectations accurately', async () => {
		const { host, captures } = createMockHost({
			scenario: {
				job: 'expected-failure',
				steps: [
					{
						step: 1,
						description: 'Missing note fails',
						command: 'note-open',
						input: { id: 'missing' },
						expect: {
							success: false,
							error: { code: 'NOTE_NOT_FOUND' },
						},
					},
				],
			},
			capturePlan: [
				{
					key: 'notes-keep-a-draft/1',
					name: 'missing-note',
					step: 1,
					after: 'Missing note fails',
					before: [],
				},
			],
			runCommand: () =>
				failure({
					code: 'NOTE_NOT_FOUND',
					message: 'Note missing does not exist.',
					suggestion: 'Create it first.',
				}),
		});

		const result = await createAfdJobDriver().run(host);
		expect(result.status).toBe('passed');
		expect(result.steps[0]?.status).toBe('passed');
		expect(captures).toHaveLength(1);
	});

	it('runs before actions for continuing steps under continueOnFailure while refusing later captures', async () => {
		let draftReady = false;
		const { host, events, captures } = createMockHost({
			scenario: {
				job: 'continue-after-fail',
				steps: [
					{
						step: 1,
						description: 'Create note',
						command: 'note-create',
						expect: { success: true },
					},
					{
						step: 2,
						description: 'Broken step',
						command: 'note-open',
						expect: { success: true },
						continueOnFailure: true,
					},
					{
						step: 3,
						description: 'Later passing step',
						command: 'note-noop',
						expect: { success: true },
					},
				],
			},
			capturePlan: [
				{
					key: 'notes-keep-a-draft/1',
					name: 'created',
					step: 1,
					after: 'Create note',
					before: [],
				},
				{
					key: 'notes-keep-a-draft/3',
					name: 'later-capture',
					step: 3,
					after: 'Later passing step',
					before: [{ action: { fill: 'draft', value: 'needed-for-step-3' } }],
				},
			],
			async runActions(actions) {
				draftReady = true;
				return actions.length;
			},
			runCommand(_runner, _target, name) {
				if (name === 'note-open') {
					return failure({ code: 'NOTE_NOT_FOUND', message: 'Not found' });
				}
				if (name === 'note-noop' && !draftReady) {
					return failure({ code: 'MISSING_DRAFT', message: 'Before action did not run' });
				}
				return success({ ok: true });
			},
		});

		const result = await createAfdJobDriver().run(host);

		expect(result.status).toBe('failed');
		expect(result.steps.map((s) => s.status)).toEqual(['passed', 'failed', 'passed']);
		expect(result.steps[2]?.actions).toBe(1);
		expect(captures.map((c) => c.key)).toEqual(['notes-keep-a-draft/1']);
		expect(events).toContain('actions:1');
		expect(events).not.toContain('capture:notes-keep-a-draft/3');
	});

	it('refuses later captures when a reference resolution error occurs under continueOnFailure', async () => {
		const { host, captures } = createMockHost({
			scenario: {
				job: 'bad-ref-continue',
				steps: [
					{
						step: 1,
						description: 'Bad step ref',
						command: 'note-open',
						input: { id: '${{ steps[9].data.id }}' },
						expect: { success: true },
						continueOnFailure: true,
					},
					{
						step: 2,
						description: 'Second step',
						command: 'note-noop',
						expect: { success: true },
					},
				],
			},
			capturePlan: [
				{
					key: 'notes-keep-a-draft/2',
					name: 'second',
					step: 2,
					after: 'Second step',
					before: [],
				},
			],
		});

		const result = await createAfdJobDriver().run(host);

		expect(result.status).toBe('failed');
		expect(result.steps.map((s) => s.status)).toEqual(['failed', 'passed']);
		expect(captures).toEqual([]);
	});

	it('cancels an in-flight command immediately when host.signal aborts and skips remaining steps', async () => {
		const controller = new AbortController();
		const { host, captures } = createMockHost({
			signal: controller.signal,
			scenario: {
				job: 'cancel-in-flight',
				steps: [
					{ step: 1, description: 'First step', command: 'note-create', expect: { success: true } },
					{ step: 2, description: 'Hanging step', command: 'note-hang', expect: { success: true } },
					{ step: 3, description: 'Unreached', command: 'note-noop', expect: { success: true } },
				],
			},
			capturePlan: [
				{
					key: 'notes-keep-a-draft/1',
					name: 'first',
					step: 1,
					after: 'First step',
					before: [],
				},
				{
					key: 'notes-keep-a-draft/3',
					name: 'unreached',
					step: 3,
					after: 'Unreached',
					before: [],
				},
			],
			runCommand(_runner, _target, name): Promise<CommandResult<unknown>> {
				if (name === 'note-hang') {
					queueMicrotask(() => controller.abort(new Error('operator cancelled')));
					return new Promise<CommandResult<unknown>>(() => {
						// Never resolves; AbortSignal must abandon this step immediately.
					});
				}
				return Promise.resolve(success({ ok: true }));
			},
		});

		const result = await createAfdJobDriver().run(host);

		expect(result.status).toBe('failed');
		expect(result.steps.map((s) => s.status)).toEqual(['passed', 'failed', 'skipped']);
		expect(result.steps[1]?.error).toMatch(/aborted/i);
		expect(captures.map((c) => c.key)).toEqual(['notes-keep-a-draft/1']);
	});

	it('skips all steps when fixture setup fails and surfaces the fixture error', async () => {
		const { host, captures } = createMockHost({
			scenario: {
				job: 'bad-fixture',
				fixture: {
					app: 'custom',
					setup: [{ command: 'note-seed' }],
				},
				steps: [
					{ step: 1, description: 'Never runs', command: 'note-create', expect: { success: true } },
				],
			},
			capturePlan: [
				{
					key: 'notes-keep-a-draft/1',
					name: 'never',
					step: 1,
					after: 'Never runs',
					before: [],
				},
			],
			runCommand: () => failure({ code: 'SEED_FAILED', message: 'Disk full' }),
		});

		const result = await createAfdJobDriver().run(host);

		expect(result.status).toBe('failed');
		expect(result.steps).toEqual([
			{
				step: 1,
				description: 'Never runs',
				command: 'note-create',
				status: 'skipped',
				error: expect.stringContaining('Disk full'),
			},
		]);
		expect(captures).toEqual([]);
	});

	it('preserves cancellation diagnostics when host.signal is already aborted before dispatch', async () => {
		const controller = new AbortController();
		controller.abort(new Error('deadline expired before start'));
		const { host, captures } = createMockHost({
			signal: controller.signal,
			scenario: {
				job: 'pre-aborted',
				steps: [
					{ step: 1, description: 'First step', command: 'note-create', expect: { success: true } },
				],
			},
			capturePlan: [
				{
					key: 'notes-keep-a-draft/1',
					name: 'first',
					step: 1,
					after: 'First step',
					before: [],
				},
			],
		});

		const result = await createAfdJobDriver().run(host);

		expect(result.status).toBe('failed');
		expect(result.steps).toEqual([
			{
				step: 1,
				description: 'First step',
				command: 'note-create',
				status: 'skipped',
				error: expect.stringContaining('deadline expired before start'),
			},
		]);
		expect(captures).toEqual([]);
	});

	it('fails a step when a command does not return a structured CommandResult', async () => {
		const { host } = createMockHost({
			scenario: {
				job: 'bad-return',
				steps: [
					{ step: 1, description: 'Malformed', command: 'note-create', expect: { success: true } },
					{
						step: 2,
						description: 'Malformed failure',
						command: 'note-open',
						expect: { success: false },
					},
				],
			},
			runCommand: (_r, _t, name) =>
				name === 'note-create' ? 'not-a-command-result' : { success: false, error: 42 },
		});

		const result = await createAfdJobDriver().run(host);
		expect(result.status).toBe('failed');
		expect(result.steps[0]?.status).toBe('failed');
		expect(result.steps[0]?.error).toMatch(/CommandResult/);

		const malformedFailureHost = createMockHost({
			scenario: {
				job: 'bad-failure-envelope',
				steps: [
					{
						step: 1,
						description: 'Malformed failure',
						command: 'note-open',
						expect: { success: false },
					},
				],
			},
			runCommand: () => ({ success: false, error: 42 }),
		});
		const malformedFailureResult = await createAfdJobDriver().run(malformedFailureHost.host);
		expect(malformedFailureResult.status).toBe('failed');
		expect(malformedFailureResult.steps[0]?.status).toBe('failed');
		expect(malformedFailureResult.steps[0]?.error).toMatch(/CommandResult/);
	});

	it('rejects entries without a job config', async () => {
		const { host } = createMockHost({
			scenario: { job: 'none', steps: [] },
			entry: { job: undefined },
		});

		await expect(createAfdJobDriver().run(host)).rejects.toThrow(/no job configuration/);
	});
});
