// Generates batch-controls.json from the TypeScript reference implementation (executeBatch and
// executePipeline in packages/core), so every language can check its batch and pipeline controls
// against the same expected values. The cases come from packages/server/src/
// execution-controls.test.ts and the pipeline executor tests in packages/core.
//
//   pnpm -F @lushly-dev/afd-core build
//   node spec/vectors/generate-batch-controls.mjs
//
// The cases run on a virtual clock, so the expected values never depend on machine speed.
import { writeFileSync } from 'node:fs';
import { setImmediate as realSetImmediate } from 'node:timers';
import { executeBatch, executePipeline, failure, success } from '../../packages/core/dist/index.js';

// ─── Virtual clock ──────────────────────────────────────────────────────────────────────────────

const clock = { now: 0, sequence: 0, timers: new Map() };
globalThis.setTimeout = (callback, ms = 0) => {
	const id = ++clock.sequence;
	clock.timers.set(id, { at: clock.now + Math.max(0, ms), id, callback });
	return id;
};
globalThis.clearTimeout = (id) => clock.timers.delete(id);
Object.defineProperty(globalThis, 'performance', {
	value: { now: () => clock.now },
	configurable: true,
	writable: true,
});

/** Settle `promise`, firing timers in time order whenever no other work is pending. */
async function runOnClock(promise) {
	let settled = false;
	promise.then(
		() => (settled = true),
		() => (settled = true)
	);
	for (;;) {
		await new Promise((resolve) => realSetImmediate(resolve));
		if (settled) return promise;
		const [next] = [...clock.timers.values()].sort((a, b) => a.at - b.at || a.id - b.id);
		if (next === undefined) throw new Error('Deadlock: nothing is pending on the clock');
		clock.timers.delete(next.id);
		clock.now = next.at;
		next.callback();
	}
}

// ─── Declarative handlers ───────────────────────────────────────────────────────────────────────

/**
 * An executor for a case's `handlers`, recording each call and the peak concurrency.
 *
 * A handler spec is `{ delayMs?, untilCancelled?, fail? }`: it takes `delayMs` on the clock (or,
 * with `untilCancelled`, runs until its signal aborts), then fails with `fail` if given, and
 * otherwise succeeds with its input as data.
 */
function executorFor(handlers) {
	const record = { calls: [], active: 0, peak: 0 };
	const execute = async (command, input, context) => {
		const spec = handlers[command];
		if (spec === undefined) throw new Error(`No handler for ${command}`);
		record.calls.push({ command, input });
		record.active++;
		record.peak = Math.max(record.peak, record.active);
		try {
			if (spec.untilCancelled) {
				const signal = context.signal;
				await new Promise((resolve) => {
					if (signal.aborted) resolve();
					else signal.addEventListener('abort', () => resolve(), { once: true });
				});
			} else if (spec.delayMs) {
				await new Promise((resolve) => setTimeout(resolve, spec.delayMs));
			}
			return spec.fail ? failure(spec.fail) : success(input);
		} finally {
			record.active--;
		}
	};
	return { execute, record };
}

// ─── Projections ────────────────────────────────────────────────────────────────────────────────

function projectError(error) {
	return {
		code: error.code,
		message: error.message,
		...(error.retryable === undefined ? {} : { retryable: error.retryable }),
	};
}

function projectBatch(result, calls) {
	if (!result.success) {
		return { success: false, error: projectError(result.error), results: [] };
	}
	return {
		success: true,
		summary: result.summary,
		results: result.results.map((entry) => {
			const ran = calls.some((call) => call.index === entry.index);
			return {
				id: entry.id,
				index: entry.index,
				command: entry.command,
				success: entry.result.success,
				...(entry.result.success
					? { data: entry.result.data }
					: { error: projectError(entry.result.error) }),
				...(ran ? {} : { durationMs: entry.durationMs }),
			};
		}),
	};
}

function projectPipeline(result) {
	return {
		...(result.data === undefined ? {} : { data: result.data }),
		completedSteps: result.metadata.completedSteps,
		totalSteps: result.metadata.totalSteps,
		steps: result.steps.map((step) => ({
			index: step.index,
			command: step.command,
			...(step.alias === undefined ? {} : { alias: step.alias }),
			status: step.status,
			...(step.data === undefined ? {} : { data: step.data }),
			...(step.error === undefined ? {} : { error: projectError(step.error) }),
		})),
	};
}

// ─── Cases ──────────────────────────────────────────────────────────────────────────────────────

const commands = (names) => names.map((command, index) => ({ command, input: { index } }));

const batchCases = [
	{
		name: 'results keep request order and IDs; IDs default to cmd-<index>',
		handlers: { 'work-run': {} },
		request: {
			commands: [
				{ command: 'work-run', input: { index: 0 } },
				{ id: 'second', command: 'work-run', input: { index: 1 } },
				{ command: 'work-run', input: { index: 2 } },
			],
		},
	},
	{
		name: 'parallelism bounds overlap and keeps request order and IDs',
		handlers: { 'work-slow': { delayMs: 20 }, 'work-run': { delayMs: 5 } },
		request: {
			commands: commands(['work-slow', 'work-run', 'work-run', 'work-run']).map((command) => ({
				id: `request-${command.input.index}`,
				...command,
			})),
			options: { parallelism: 2 },
		},
	},
	{
		name: 'without stopOnError every command runs',
		handlers: { 'work-run': {}, 'work-fail': { fail: { code: 'EXPECTED', message: 'stop' } } },
		request: { commands: commands(['work-run', 'work-fail', 'work-run']) },
	},
	{
		name: 'stopOnError stops scheduling after a failure; the rest are COMMAND_SKIPPED',
		handlers: { 'work-run': {}, 'work-fail': { fail: { code: 'EXPECTED', message: 'stop' } } },
		request: {
			commands: commands(['work-fail', 'work-run', 'work-run']),
			options: { stopOnError: true },
		},
	},
	{
		name: 'the deadline is enforced while a command is awaited',
		handlers: { 'work-hang': { untilCancelled: true } },
		request: { commands: commands(['work-hang']), options: { timeout: 20 } },
	},
	{
		name: 'a command running at the deadline, and every later one, gets BATCH_TIMEOUT',
		handlers: { 'work-run': { delayMs: 1 }, 'work-slow': { delayMs: 500 } },
		request: {
			commands: commands(['work-run', 'work-slow', 'work-run']),
			options: { timeout: 50 },
		},
	},
	{
		name: 'timeout 0 times out every command without running any',
		handlers: { 'work-run': {} },
		request: { commands: commands(['work-run', 'work-run']), options: { timeout: 0 } },
	},
];

const invalidBatches = [
	['a batch with no commands', { commands: [] }],
	['a blank command name', { commands: [{ command: '  ' }] }],
	['a numeric ID', { commands: [{ command: 'work-run', id: 7 }] }],
	['a null ID', { commands: [{ command: 'work-run', id: null }] }],
	['a null command entry', { commands: [{ command: 'work-run', input: {} }, null] }],
	['parallelism 0', { commands: [{ command: 'work-run' }], options: { parallelism: 0 } }],
	[
		'fractional parallelism',
		{ commands: [{ command: 'work-run' }], options: { parallelism: 1.5 } },
	],
	['a negative timeout', { commands: [{ command: 'work-run' }], options: { timeout: -1 } }],
	[
		'a string stopOnError',
		{ commands: [{ command: 'work-run' }], options: { stopOnError: 'false' } },
	],
	['null options', { commands: [{ command: 'work-run' }], options: null }],
	['commands given as an object', { commands: {} }],
	['an envelope without commands', {}],
	['an array envelope', []],
	['a null envelope', null],
];
for (const [what, request] of invalidBatches) {
	batchCases.push({
		name: `invalid envelope: ${what}; nothing runs`,
		handlers: { 'work-run': {} },
		request,
	});
}

const pipelineCases = [
	{
		name: 'an empty pipeline runs nothing and returns no steps',
		handlers: {},
		request: { steps: [] },
	},
	{
		name: 'a failure stops the pipeline; later steps are skipped without an error',
		handlers: {
			'fail-now': { fail: { code: 'EXPECTED', message: 'failed on purpose' } },
			'then-run': {},
		},
		request: { steps: [{ command: 'fail-now' }, { command: 'then-run' }] },
	},
	{
		name: 'continueOnFailure runs every step; a failed step is absent to references',
		handlers: {
			'fail-now': { fail: { code: 'EXPECTED', message: 'failed on purpose' } },
			'then-run': {},
		},
		request: {
			steps: [{ command: 'fail-now' }, { command: 'then-run', input: { x: '$steps[0]', y: 1 } }],
			options: { continueOnFailure: true },
		},
	},
	{
		name: 'a step running at the deadline fails, and later steps are skipped with PIPELINE_TIMEOUT even with continueOnFailure',
		handlers: { 'quick-a': {}, 'slow-b': { delayMs: 500 }, 'quick-c': {} },
		request: {
			steps: [{ command: 'quick-a' }, { command: 'slow-b' }, { command: 'quick-c' }],
			options: { timeoutMs: 50, continueOnFailure: true },
		},
	},
	{
		name: 'the deadline is enforced while a step is awaited',
		handlers: { 'work-hang': { untilCancelled: true } },
		request: { steps: [{ command: 'work-hang' }], options: { timeoutMs: 20 } },
	},
	{
		name: 'timeoutMs 0 times out the first step without running it',
		handlers: { 'work-run': {} },
		request: {
			steps: [{ command: 'work-run' }, { command: 'work-run' }],
			options: { timeoutMs: 0 },
		},
	},
	{
		name: 'parallel fails step 0 with UNSUPPORTED_OPTION and skips the rest, running nothing',
		handlers: { 'work-one': {}, 'work-two': {} },
		request: {
			steps: [{ command: 'work-one' }, { command: 'work-two' }],
			options: { parallel: true },
		},
	},
	{
		name: 'a streaming step fails with UNSUPPORTED_OPTION and every other step is skipped',
		handlers: { 'work-one': {}, 'work-two': {}, 'work-three': {} },
		request: {
			steps: [
				{ command: 'work-one', as: 'first' },
				{ command: 'work-two', stream: true },
				{ command: 'work-three', stream: true },
			],
		},
	},
	{
		name: 'parallel is blamed on step 0 even when a later step streams',
		handlers: { 'work-one': {}, 'work-two': {} },
		request: {
			steps: [{ command: 'work-one' }, { command: 'work-two', stream: true }],
			options: { parallel: true },
		},
	},
	{
		name: 'stream: false and parallel: false are accepted',
		handlers: { 'work-one': {} },
		request: { steps: [{ command: 'work-one', stream: false }], options: { parallel: false } },
	},
];

const invalidPipelines = [
	['a blank command name', { steps: [{ command: ' ' }] }],
	['an array step input', { steps: [{ command: 'work-run', input: [] }] }],
	['a null alias', { steps: [{ command: 'work-run', as: null }] }],
	['a non-string $exists', { steps: [{ command: 'work-run', when: { $exists: 1 } }] }],
	['a non-numeric $gt bound', { steps: [{ command: 'work-run', when: { $gt: ['$prev', true] } }] }],
	[
		'a condition with two operators',
		{ steps: [{ command: 'work-run', when: { $exists: '$prev', $not: {} } }] },
	],
	[
		'a malformed condition on a later step',
		{ steps: [{ command: 'work-run' }, { command: 'work-run', when: { $eq: null } }] },
	],
	['a negative timeoutMs', { steps: [{ command: 'work-run' }], options: { timeoutMs: -5 } }],
	['a non-function onProgress', { steps: [{ command: 'work-run' }], options: { onProgress: 1 } }],
	['steps given as an object', { steps: {} }],
	['a numeric ID', { id: 7, steps: [] }],
	['an array envelope', []],
];
for (const [what, request] of invalidPipelines) {
	pipelineCases.push({
		name: `invalid envelope: ${what}; no step runs`,
		handlers: { 'work-run': {} },
		request,
	});
}

// ─── Run ────────────────────────────────────────────────────────────────────────────────────────

async function runBatch(testCase) {
	const { execute, record } = executorFor(testCase.handlers);
	// Record the batch index of each call (its trace ID is batch-<index>), so a result can say
	// whether its command ran.
	const withIndex = (command, input, context) => {
		const pending = execute(command, input, context);
		record.calls.at(-1).index = Number(context.traceId.slice('batch-'.length));
		return pending;
	};
	const result = await runOnClock(executeBatch(testCase.request, withIndex, { traceId: 'batch' }));
	return {
		calls: record.calls.map(({ command, input }) => ({ command, input })),
		...(result.success ? { peakConcurrency: record.peak } : {}),
		...projectBatch(result, record.calls),
	};
}

async function runPipeline(testCase) {
	const { execute, record } = executorFor(testCase.handlers);
	const result = await runOnClock(executePipeline(testCase.request, execute));
	return { calls: record.calls, ...projectPipeline(result) };
}

const vectors = {
	description:
		'Batch and pipeline execution controls (stopOnError, parallelism, deadlines, continueOnFailure, unsupported options and envelope validation), with expected values produced by the TypeScript executors on a virtual clock. See spec/vectors/README.md for how to run a case. Regenerate with node spec/vectors/generate-batch-controls.mjs.',
	handlers:
		'Each case maps command names to handlers. A handler takes delayMs milliseconds on the clock (or, with untilCancelled, runs until the executor cancels it at the deadline), then fails with fail if given, and otherwise succeeds with its input as data.',
	batch: [],
	pipeline: [],
};
for (const testCase of batchCases) {
	vectors.batch.push({ ...testCase, expected: await runBatch(testCase) });
}
for (const testCase of pipelineCases) {
	vectors.pipeline.push({ ...testCase, expected: await runPipeline(testCase) });
}

writeFileSync(
	new URL('./batch-controls.json', import.meta.url),
	`${JSON.stringify(vectors, null, '\t')}\n`
);
