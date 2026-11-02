/**
 * `/view` over a fake parent window. The real frames and the conformance fixture run in step 5's
 * Chromium suite (E2).
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineApp, failure, success } from './index.js';
import { connectView, mulberry32, serveHandlers } from './view.js';

interface Message {
	jsonrpc: '2.0';
	id?: number | string;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

type Responder = (message: Message) => unknown;

function installWindow(respond: Record<string, Responder> = {}) {
	const posted: Message[] = [];
	const listeners = new Set<(event: { source: unknown; data: unknown }) => void>();
	const parent = {
		postMessage(message: Message) {
			posted.push(message);
			if (message.method === undefined || message.id === undefined) return;
			const responder = respond[message.method];
			if (!responder) return;
			const answer = responder(message);
			queueMicrotask(() => {
				deliver(
					answer && typeof answer === 'object' && 'error' in answer
						? { jsonrpc: '2.0', id: message.id, ...answer }
						: { jsonrpc: '2.0', id: message.id, result: answer }
				);
			});
		},
	};
	const deliver = (data: unknown, source: unknown = parent): void => {
		for (const listener of listeners) listener({ source, data });
	};
	const properties = new Map<string, string>();
	vi.stubGlobal('window', {
		parent,
		addEventListener: (_type: string, listener: (event: never) => void) => {
			listeners.add(listener as never);
		},
	});
	vi.stubGlobal('document', {
		documentElement: {
			style: { setProperty: (name: string, value: string) => properties.set(name, value) },
		},
	});
	return { posted, deliver, properties };
}

const HOST_CONTEXT = {
	theme: 'light',
	platform: 'web',
	displayMode: 'inline',
	containerDimensions: { width: 800, height: 600 },
	'dev.loam/tokens': { '--color-surface-page': '#FFFEFA' },
};

const initialize = () => ({ protocolVersion: '2026-01-26', hostContext: HOST_CONTEXT });
const tick = () => new Promise((resolve) => setTimeout(resolve));

beforeEach(() => {
	vi.unstubAllGlobals();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('connectView', () => {
	it('initializes, applies the tokens, then says it is initialized', async () => {
		const { posted, properties } = installWindow({ 'ui/initialize': initialize });
		const view = await connectView({ name: 'hello', version: '1.0.0' });
		expect(posted[0]?.method).toBe('ui/initialize');
		expect(posted[0]?.params).toMatchObject({
			protocolVersion: '2026-01-26',
			appInfo: { name: 'hello', version: '1.0.0' },
		});
		expect(posted[1]?.method).toBe('ui/notifications/initialized');
		expect(posted[1]?.id).toBeUndefined();
		expect(view.hostContext.theme).toBe('light');
		expect(properties.get('--color-surface-page')).toBe('#FFFEFA');
	});

	it('takes a command result from a tool call', async () => {
		const result = success({ greeting: 'Hello, Ada!' });
		const { posted } = installWindow({
			'ui/initialize': initialize,
			'tools/call': () => ({ content: [], structuredContent: result, isError: false }),
		});
		const view = await connectView();
		expect(await view.client.call('hello-greet', { name: 'Ada' })).toEqual(result);
		expect(posted.at(-1)?.params).toEqual({ name: 'hello-greet', arguments: { name: 'Ada' } });
	});

	it('reads a result from the text content when a host sends only that', async () => {
		const result = success(1);
		installWindow({
			'ui/initialize': initialize,
			'tools/call': () => ({ content: [{ type: 'text', text: JSON.stringify(result) }] }),
		});
		const view = await connectView();
		expect(await view.client.call('hello-ping')).toEqual(result);
	});

	it('names an answer that holds no result', async () => {
		installWindow({ 'ui/initialize': initialize, 'tools/call': () => ({ content: [] }) });
		const view = await connectView();
		const result = await view.client.call('hello-ping');
		expect(result.error?.code).toBe('VIEW_RESULT_INVALID');
	});

	it('turns a refused call into a failure, keeping a code the host names', async () => {
		let answer: unknown = { error: { code: -32602, message: 'Refused.' } };
		installWindow({ 'ui/initialize': initialize, 'tools/call': () => answer });
		const view = await connectView();
		const plain = await view.client.call('tally-add');
		expect(plain.error?.code).toBe('VIEW_CALL_REFUSED');
		expect(plain.error?.suggestion).toBeTruthy();
		answer = {
			error: {
				code: -32000,
				message: 'No call.',
				data: { code: 'HANDLER_NO_CALL', suggestion: 'Call inside a handler.' },
			},
		};
		const named = await view.client.call('hello-ping');
		expect(named.error).toMatchObject({
			code: 'HANDLER_NO_CALL',
			suggestion: 'Call inside a handler.',
		});
	});

	it('answers an aborted call with a failure', async () => {
		installWindow({ 'ui/initialize': initialize });
		const view = await connectView();
		const controller = new AbortController();
		const pending = view.client.call('hello-ping', {}, { signal: controller.signal });
		controller.abort();
		expect((await pending).error?.code).toBe('CALL_ABORTED');
		const again = await view.client.call('hello-ping', {}, { signal: controller.signal });
		expect(again.error?.code).toBe('CALL_ABORTED');
	});

	it('reads a resource and rejects a refused one', async () => {
		installWindow({
			'ui/initialize': initialize,
			'resources/read': (message) =>
				message.params?.uri === 'ui://hello/main'
					? { contents: [{ uri: 'ui://hello/main', text: '<p>Hi</p>' }] }
					: { error: { code: -32602, message: 'Not this app.' } },
		});
		const view = await connectView();
		expect(await view.readResource('ui://hello/main')).toBe('<p>Hi</p>');
		await expect(view.readResource('ui://tally/main')).rejects.toThrow('Not this app.');
	});

	it('holds a pushed input and result until a listener arrives', async () => {
		const { deliver } = installWindow({ 'ui/initialize': initialize });
		const view = await connectView();
		deliver({
			jsonrpc: '2.0',
			method: 'ui/notifications/tool-input',
			params: { arguments: { name: 'Ada' } },
		});
		const result = success(1);
		deliver({
			jsonrpc: '2.0',
			method: 'ui/notifications/tool-result',
			params: { structuredContent: result },
		});
		const inputs: unknown[] = [];
		const results: unknown[] = [];
		const stop = view.onToolInput((args) => inputs.push(args));
		view.onToolResult((value) => results.push(value));
		expect(inputs).toEqual([{ name: 'Ada' }]);
		expect(results).toEqual([result]);
		stop();
		deliver({
			jsonrpc: '2.0',
			method: 'ui/notifications/tool-input',
			params: { arguments: { name: 'Grace' } },
		});
		expect(inputs).toEqual([{ name: 'Ada' }]);
	});

	it('passes on a cancelled call', async () => {
		const { deliver } = installWindow({ 'ui/initialize': initialize });
		const view = await connectView();
		const reasons: unknown[] = [];
		view.onToolCancelled((reason) => reasons.push(reason));
		deliver({
			jsonrpc: '2.0',
			method: 'ui/notifications/tool-cancelled',
			params: { reason: 'app-switch' },
		});
		expect(reasons).toEqual(['app-switch']);
	});

	it('applies a changed context', async () => {
		const { deliver, properties } = installWindow({ 'ui/initialize': initialize });
		const view = await connectView();
		const seen: unknown[] = [];
		view.onHostContext((context) => seen.push(context));
		const change = { theme: 'dark', 'dev.loam/tokens': { '--color-surface-page': '#111' } };
		deliver({
			jsonrpc: '2.0',
			method: 'ui/notifications/host-context-changed',
			params: change,
		});
		expect(seen).toEqual([change]);
		expect(view.hostContext.theme).toBe('dark');
		expect(properties.get('--color-surface-page')).toBe('#111');
	});

	it('runs teardown listeners before answering', async () => {
		const { deliver, posted } = installWindow({ 'ui/initialize': initialize });
		const view = await connectView();
		const order: string[] = [];
		const stop = view.onTeardown(async () => {
			await tick();
			order.push('listener');
		});
		deliver({ jsonrpc: '2.0', id: 'host-1', method: 'ui/resource-teardown', params: {} });
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(order).toEqual(['listener']);
		expect(posted.at(-1)).toMatchObject({ id: 'host-1', result: {} });
		stop();
	});

	it('ignores a message from any other window, and answers an unknown request', async () => {
		const { deliver, posted } = installWindow({ 'ui/initialize': initialize });
		const view = await connectView();
		const inputs: unknown[] = [];
		view.onToolInput((args) => inputs.push(args));
		deliver(
			{ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: 1 } },
			{}
		);
		deliver('not a message');
		expect(inputs).toEqual([]);
		deliver({ jsonrpc: '2.0', id: 'host-2', method: 'ping', params: {} });
		deliver({ jsonrpc: '2.0', id: 'host-3', method: 'nope', params: {} });
		await tick();
		expect(posted.find((message) => message.id === 'host-2')?.result).toEqual({});
		expect(posted.find((message) => message.id === 'host-3')?.error?.code).toBe(-32601);
	});
});

describe('mulberry32', () => {
	it('repeats from one seed and stays in [0, 1)', () => {
		const first = mulberry32(42);
		const second = mulberry32(42);
		const values = [first(), first(), first()];
		expect([second(), second(), second()]).toEqual(values);
		expect(new Set(values).size).toBe(3);
		for (const value of values) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});
});

describe('serveHandlers', () => {
	const call = (command: string, context: Record<string, unknown>, input: unknown = {}) => ({
		jsonrpc: '2.0',
		id: 'call-1',
		method: 'dev.loam/handler-call',
		params: {
			callId: 'c1',
			command,
			input,
			context: { traceId: 't1', config: { limit: 3 }, grants: [], ...context },
		},
	});

	it('says which handlers it has', () => {
		const { posted } = installWindow();
		serveHandlers(defineApp({ sdk: 1, handlers: { 'hello-ping': async () => success(1) } }));
		expect(posted[0]).toMatchObject({
			method: 'dev.loam/handlers-ready',
			params: { sdk: 1, commands: ['hello-ping'] },
		});
		expect(posted[0]?.id).toBeUndefined();
	});

	it('gives a handler only what is granted', async () => {
		const seen: Record<string, unknown>[] = [];
		const { deliver } = installWindow();
		serveHandlers({
			sdk: 1,
			handlers: {
				'hello-ping': async (input, context) => {
					seen.push({ input, ...context });
					return success(1);
				},
			},
		});
		deliver(call('hello-ping', {}, { a: 1 }));
		await tick();
		expect(seen[0]).toMatchObject({ input: { a: 1 }, traceId: 't1', config: { limit: 3 } });
		expect(seen[0]?.now).toBeUndefined();
		expect(seen[0]?.random).toBeUndefined();
		expect(seen[0]?.store).toBeUndefined();
	});

	it('uses the one clock reading and the seeded generator of the call', async () => {
		const seen: number[][] = [];
		const { deliver, posted } = installWindow();
		serveHandlers({
			sdk: 1,
			handlers: {
				'hello-ping': async (_input, context) => {
					seen.push([
						context.now?.() as number,
						context.now?.() as number,
						context.random?.() as number,
					]);
					return success(1);
				},
			},
		});
		deliver(call('hello-ping', { grants: ['clock', 'random'], now: 1000, randomSeed: 7 }));
		await tick();
		expect(seen[0]).toEqual([1000, 1000, mulberry32(7)()]);
		expect(posted.at(-1)).toMatchObject({ id: 'call-1', result: { success: true, data: 1 } });
	});

	it('ties the store and nested calls to the call', async () => {
		const storeCalls: unknown[] = [];
		const toolCalls: unknown[] = [];
		const { deliver, posted } = installWindow({
			'dev.loam/store': (message) => {
				storeCalls.push(message.params);
				const { op } = message.params as { op: string };
				return op === 'get' ? 'value' : op === 'list' ? [{ key: 'a', value: 1 }] : {};
			},
			'tools/call': (message) => {
				toolCalls.push(message.params);
				return { structuredContent: success('nested') };
			},
		});
		const results: unknown[] = [];
		serveHandlers({
			sdk: 1,
			handlers: {
				'hello-ping': async (_input, context) => {
					results.push(await context.store?.get('a'));
					await context.store?.put('a', 2);
					results.push(await context.store?.list());
					results.push(await context.store?.list('a'));
					await context.store?.delete('a');
					results.push((await context.client.call('hello-list')).data);
					return success(1);
				},
			},
		});
		deliver(call('hello-ping', { grants: ['store'] }));
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(results).toEqual([
			'value',
			[{ key: 'a', value: 1 }],
			[{ key: 'a', value: 1 }],
			'nested',
		]);
		expect(storeCalls).toEqual([
			{ callId: 'c1', op: 'get', key: 'a' },
			{ callId: 'c1', op: 'put', key: 'a', value: 2 },
			{ callId: 'c1', op: 'list' },
			{ callId: 'c1', op: 'list', prefix: 'a' },
			{ callId: 'c1', op: 'delete', key: 'a' },
		]);
		expect(toolCalls).toEqual([
			{ name: 'hello-list', arguments: {}, _meta: { 'dev.loam/call': 'c1' } },
		]);
		expect(posted.at(-1)).toMatchObject({ id: 'call-1', result: { success: true } });
	});

	it('answers a missing handler and a throwing one with a failure', async () => {
		const { deliver, posted } = installWindow();
		serveHandlers({
			sdk: 1,
			handlers: {
				'hello-boom': async () => {
					throw new Error('Boom.');
				},
				'hello-refuse': async () => failure({ code: 'NOPE', message: 'No.', suggestion: 'Stop.' }),
			},
		});
		deliver(call('hello-none', {}));
		await tick();
		expect(posted.at(-1)).toMatchObject({ result: { error: { code: 'APP_HANDLER_MISSING' } } });
		deliver(call('hello-boom', {}));
		await tick();
		// What it threw stays in the frame's console: the result is journaled (9.6, and step 5's decision).
		expect(posted.at(-1)).toMatchObject({
			result: { error: { code: 'HANDLER_THREW', message: 'The handler of `hello-boom` threw.' } },
		});
		expect(JSON.stringify(posted.at(-1))).not.toContain('Boom.');
		deliver(call('hello-refuse', {}));
		await tick();
		expect(posted.at(-1)).toMatchObject({ result: { error: { code: 'NOPE' } } });
	});
});

describe('the sandboxed entry', () => {
	it('defines no element and has no Node.js builtin', () => {
		for (const file of ['./view.ts', './rpc.ts']) {
			const source = readFileSync(new URL(file, import.meta.url), 'utf8');
			expect(source).not.toMatch(/customElements|from 'node:/);
		}
	});
});
