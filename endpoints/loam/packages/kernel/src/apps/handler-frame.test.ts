import type { CommandResult, JournalEntry } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createFixturePorts,
	createSteppingClock,
	createTestKernel,
	probeDefinition,
	probeDeployment,
	probeViewManifest,
} from '../testing.js';
import type { HandlerFrameV1, KernelPortsV1, LoamKernelV1 } from '../types.js';
import { HANDLER_CALL_TIMEOUT_MS, HANDLER_READY_TIMEOUT_MS } from './index.js';

const kernels: LoamKernelV1[] = [];
afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const SANDBOX = 'https://sandbox.loam.test';
const HANDLERS = '<!doctype html><title>Handlers</title>';
const entry = { instance: 'probev', app: 'probev', package: 'apps/probev/' };

function ports(overrides: Partial<KernelPortsV1> = {}) {
	return {
		...createFixturePorts({
			'apps/probev/': {
				manifest: probeViewManifest(),
				definition: probeDefinition('probev'),
				files: { 'handlers.html': HANDLERS, 'main.html': '<!doctype html><h1>Probe</h1>' },
			},
		}),
		...overrides,
	};
}

async function boot(portsGiven: KernelPortsV1 = ports()) {
	const { kernel, journal } = await createTestKernel({
		deployment: probeDeployment([entry], SANDBOX),
		ports: portsGiven,
		clock: createSteppingClock(),
	});
	kernels.push(kernel);
	return { kernel, journal };
}

/** A frame whose every answer the test decides. */
function fakeFrame(overrides: Partial<HandlerFrameV1> = {}): HandlerFrameV1 & {
	ask?: (method: string, params: unknown) => Promise<unknown>;
	closed: number;
} {
	const frame = {
		closed: 0,
		ready: Promise.resolve(probeViewCommands()),
		call: () => Promise.resolve({ success: true, data: {} } as CommandResult),
		onRequest(handler: (method: string, params: unknown) => Promise<unknown>) {
			frame.ask = handler;
		},
		close() {
			frame.closed++;
		},
		...overrides,
	} as HandlerFrameV1 & {
		ask?: (method: string, params: unknown) => Promise<unknown>;
		closed: number;
	};
	return frame;
}

const probeViewCommands = () => (probeViewManifest().commands ?? []).map((command) => command.name);

describe('the handler frame (6.3, D61)', () => {
	it('opens lazily, once, from `view.handlers`, and runs the same definition', async () => {
		const given = ports();
		const html: string[] = [];
		const opener = given.openHandlerFrame;
		given.openHandlerFrame = (instance, text) => {
			html.push(text);
			return opener(instance, text);
		};
		const { kernel } = await boot(given);
		expect(given.framesOpened).toEqual([]);
		expect((await kernel.call('app-get', { instance: 'probev' })).data).toMatchObject({
			kind: 'view',
			trust: 'sandboxed',
			trustLine: 'Sandboxed: its grants are enforced.',
		});
		const noted = await kernel.call<{ key: string; greeting: string | null }>('probev-note', {
			text: 'one',
		});
		expect(noted.success).toBe(true);
		const listed = await kernel.call<{ items: unknown[] }>('probev-list');
		expect(listed.data?.items).toHaveLength(1);
		expect(given.framesOpened).toEqual(['probev']);
		expect(html).toEqual([HANDLERS]);
	});

	it('gives a frame one clock reading and one random seed, on the tape', async () => {
		const { kernel, journal } = await boot();
		await kernel.call('probev-note', { text: 'one' });
		const recorded = (await journal.read()).at(-1) as JournalEntry;
		expect(recorded.tape?.random).toHaveLength(1);
		const key = (recorded.result.data as { key: string }).key;
		expect(recorded.tape?.clock).toContain(Number(key.replace('note-', '')));
	});

	it('runs nested queries and refuses nested mutations through the broker', async () => {
		const { kernel, journal } = await boot();
		expect((await kernel.call<{ count: number }>('probev-count')).data?.count).toBe(0);
		expect((await kernel.call<{ refused: string }>('probev-sneak')).data?.refused).toBe(
			'NESTED_MUTATION_REFUSED'
		);
		expect((await kernel.call<{ refused: string }>('probev-peek')).data?.refused).toBe(
			'CALL_NOT_GRANTED'
		);
		const entries = await journal.read();
		expect(entries.find((recorded) => recorded.command === 'probev-list')?.context?.parent).toBe(
			entries.find((recorded) => recorded.command === 'probev-count')?.traceId
		);
	});

	it('refuses a frame request outside a call in flight', async () => {
		const frame = fakeFrame();
		const { kernel, journal } = await boot(
			ports({ openHandlerFrame: () => Promise.resolve(frame) })
		);
		await kernel.call('probev-list');
		const before = (await journal.read()).length;
		await expect(
			frame.ask?.('dev.loam/store', { callId: 'old', op: 'put', key: 'a', value: 1 })
		).rejects.toMatchObject({ code: 'HANDLER_NO_CALL', details: { rpcCode: -32600 } });
		await expect(
			frame.ask?.('tools/call', { name: 'probev-list', arguments: {} })
		).rejects.toMatchObject({ code: 'HANDLER_NO_CALL' });
		await expect(frame.ask?.('other/method', {})).rejects.toMatchObject({
			details: { rpcCode: -32601 },
		});
		expect(await journal.read()).toHaveLength(before);
	});

	it('refuses the store with -32601 without the grant', async () => {
		const manifest = { ...probeViewManifest(), grants: [] };
		manifest.commands = manifest.commands?.map((command) => ({
			...command,
			effects: ['plugin-state'],
		})) as typeof manifest.commands;
		const frame = fakeFrame();
		const given = createFixturePorts({
			'apps/probev/': { manifest, files: { 'handlers.html': HANDLERS } },
		});
		given.openHandlerFrame = () => Promise.resolve(frame);
		const { kernel } = await boot(given);
		await kernel.call('probev-list');
		await expect(
			frame.ask?.('dev.loam/store', { callId: 'any', op: 'get', key: 'a' })
		).rejects.toMatchObject({ details: { rpcCode: -32601 } });
	});

	it('refuses a command its visibility hides from the app, with -32602', async () => {
		const manifest = probeViewManifest();
		manifest.commands = manifest.commands?.map((command) =>
			command.name === 'probev-list'
				? { ...command, tool_meta: { ui: { visibility: ['model'] } } }
				: command.name === 'probev-note'
					? { ...command, tool_meta: { ui: { visibility: ['app'] } } }
					: command
		) as typeof manifest.commands;
		let answer: unknown;
		const frame = fakeFrame({
			async call({ callId }) {
				answer = await frame
					.ask?.('tools/call', {
						name: 'probev-list',
						arguments: {},
						_meta: { 'dev.loam/call': callId },
					})
					.catch((refusal: unknown) => refusal);
				return { success: true, data: {} };
			},
		});
		const given = createFixturePorts({
			'apps/probev/': { manifest, files: { 'handlers.html': HANDLERS } },
		});
		given.openHandlerFrame = () => Promise.resolve(frame);
		const { kernel } = await boot(given);
		await kernel.call('probev-count');
		expect(answer).toMatchObject({ details: { rpcCode: -32602 } });
		// Hidden from the model: not the agent's.
		expect(kernel.agent.listCommands().map((command) => command.name)).not.toContain('probev-note');
	});

	it('answers a frame that never reports ready, then opens it again', async () => {
		vi.useFakeTimers();
		const never = fakeFrame({ ready: new Promise(() => {}) });
		const good = fakeFrame();
		const frames = [never, good];
		const { kernel } = await boot(
			ports({ openHandlerFrame: () => Promise.resolve(frames.shift() as HandlerFrameV1) })
		);
		const pending = kernel.call('probev-list');
		await vi.advanceTimersByTimeAsync(HANDLER_READY_TIMEOUT_MS + 1);
		const result = await pending;
		expect(result.error?.code).toBe('HANDLER_READY_TIMEOUT');
		expect(result.error?.retryable).toBe(true);
		expect(never.closed).toBe(1);
		expect((await kernel.call('probev-list')).success).toBe(true);
	});

	it('answers a call unanswered in time, discards the frame and re-creates it', async () => {
		vi.useFakeTimers();
		const slow = fakeFrame({ call: () => new Promise(() => {}) });
		const good = fakeFrame();
		const frames = [slow, good];
		const opened: string[] = [];
		const { kernel } = await boot(
			ports({
				openHandlerFrame: (instance) => {
					opened.push(instance);
					return Promise.resolve(frames.shift() as HandlerFrameV1);
				},
			})
		);
		const pending = kernel.call('probev-list');
		await vi.advanceTimersByTimeAsync(HANDLER_CALL_TIMEOUT_MS + 1);
		expect((await pending).error?.code).toBe('HANDLER_TIMEOUT');
		expect(slow.closed).toBe(1);
		expect((await kernel.call('probev-list')).success).toBe(true);
		expect(opened).toHaveLength(2);
	});

	it('does not close the replacement frame when an older call times out', async () => {
		vi.useFakeTimers();
		const first = fakeFrame({ call: () => new Promise(() => {}) });
		const second = fakeFrame({ call: () => new Promise(() => {}) });
		const frames = [first, second];
		const { kernel } = await boot(
			ports({ openHandlerFrame: () => Promise.resolve(frames.shift() as HandlerFrameV1) })
		);
		const earliest = kernel.call('probev-list');
		await vi.advanceTimersByTimeAsync(HANDLER_CALL_TIMEOUT_MS / 2);
		const stale = kernel.call('probev-list');
		await vi.advanceTimersByTimeAsync(HANDLER_CALL_TIMEOUT_MS / 2 + 1);
		await earliest;
		expect(first.closed).toBe(1);
		const current = kernel.call('probev-list');
		await vi.advanceTimersByTimeAsync(HANDLER_CALL_TIMEOUT_MS / 2 + 1);
		await stale;
		expect(second.closed).toBe(0);
		await vi.advanceTimersByTimeAsync(HANDLER_CALL_TIMEOUT_MS);
		await current;
		expect(second.closed).toBe(1);
	});

	it('refuses malformed frame requests with -32602, and names no value', async () => {
		let answers: unknown[] = [];
		const frame = fakeFrame({
			async call({ callId }) {
				const ask = (method: string, params: Record<string, unknown>) =>
					(frame.ask as NonNullable<typeof frame.ask>)(method, { callId, ...params }).catch(
						(refusal: unknown) => refusal
					);
				answers = await Promise.all([
					ask('dev.loam/store', { op: 'put', key: 5, value: 1 }),
					ask('dev.loam/store', { op: 'wipe', key: 'a' }),
					ask('dev.loam/store', { op: 'list', prefix: 5 }),
					ask('tools/call', { name: { toString: 1 }, _meta: { 'dev.loam/call': callId } }),
				]);
				return { success: true, data: {} };
			},
		});
		const { kernel } = await boot(ports({ openHandlerFrame: () => Promise.resolve(frame) }));
		await kernel.call('probev-list');
		expect(answers).toHaveLength(4);
		for (const answer of answers) expect(answer).toMatchObject({ details: { rpcCode: -32602 } });
	});

	it('refuses a result that is not a CommandResult', async () => {
		const answers: unknown[] = [{ nope: true }, { success: false }, 'text'];
		const frame = fakeFrame({ call: () => Promise.resolve(answers.shift() as CommandResult) });
		const { kernel } = await boot(ports({ openHandlerFrame: () => Promise.resolve(frame) }));
		for (let i = 0; i < 3; i++) {
			expect((await kernel.call('probev-list')).error?.code).toBe('HANDLER_RESULT_INVALID');
		}
	});

	it('fails the app when the frame reports other commands', async () => {
		const frame = fakeFrame({ ready: Promise.resolve(['probev-list']) });
		const { kernel } = await boot(ports({ openHandlerFrame: () => Promise.resolve(frame) }));
		const called = await kernel.call('probev-list');
		expect(called.error?.code).toBe('APP_HANDLER_MISSING');
		expect((await kernel.call('probev-list')).error?.code).toBe('APP_NOT_READY');
	});

	it('answers a frame that cannot open, and a call the frame drops', async () => {
		const { kernel } = await boot(
			ports({ openHandlerFrame: () => Promise.reject(new Error('No frame')) })
		);
		const called = await kernel.call('probev-list');
		expect(called.error?.code).toBe('HANDLER_READY_TIMEOUT');
		expect(called.error?.message).toContain('No frame');

		const dropped = fakeFrame({ call: () => Promise.reject(new Error('Gone')) });
		const other = await boot(ports({ openHandlerFrame: () => Promise.resolve(dropped) }));
		expect((await other.kernel.call('probev-list')).error?.code).toBe('CALL_ABORTED');
	});

	it('answers a handler that throws, in process, as the SDK does', async () => {
		const definition = probeDefinition('probev');
		const given = createFixturePorts({
			'apps/probev/': {
				manifest: probeViewManifest(),
				definition: {
					...definition,
					handlers: {
						...definition.handlers,
						'probev-list': (async () => {
							throw new Error('Oops');
						}) as never,
					},
				},
				files: { 'handlers.html': HANDLERS },
			},
		});
		const { kernel } = await boot(given);
		expect((await kernel.call('probev-list')).error?.code).toBe('HANDLER_THREW');
	});

	it('reads only its own resources from the package', async () => {
		const { kernel } = await boot();
		const port = kernel.appPort('probev');
		await expect(port.readResource('ui://probev/main')).resolves.toContain('<h1>Probe</h1>');
		await expect(port.readResource('handlers.html')).resolves.toBe(HANDLERS);
		await expect(port.readResource('ui://probev/other')).rejects.toMatchObject({
			code: 'VIEW_RESOURCE_UNAVAILABLE',
		});
		await expect(port.load()).rejects.toMatchObject({ code: 'APP_NOT_READY' });
	});

	it('closes a frame at disposal', async () => {
		const frame = fakeFrame();
		const { kernel } = await boot(ports({ openHandlerFrame: () => Promise.resolve(frame) }));
		await kernel.call('probev-list');
		await kernel.dispose();
		expect(frame.closed).toBe(1);
	});
});
