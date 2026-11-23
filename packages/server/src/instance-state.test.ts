/**
 * The `instances` option: a server that several processes serve refuses to depend on what is kept
 * per process (the elicitation `requestState` key and approval nonces), and one that says nothing
 * warns once when served over HTTP. Also the `confirmationKey` length rule.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type CommandMiddleware, success } from '@lushly-dev/afd-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type ApprovalNonceStore, createApprovalMiddleware } from './approval.js';
import { composeMiddleware } from './middleware.js';
import { defineCommand } from './schema.js';
import { createMcpHandler, createMcpServer } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const SECRET = 'test-approval-secret-0123456789abcdef';
const KEY = 'test-confirmation-key-0123456789abcdef';

const clear = defineCommand({
	name: 'todo-clear',
	description: 'Delete every todo',
	mutation: true,
	confirmPrompt: 'Delete every todo?',
	approval: 'not-required',
	expose: { mcp: true },
	input: z.object({}),
	handler: async () => success({ cleared: true }),
});

const sharedStore: ApprovalNonceStore = { consume: () => true };

function handler(options: Partial<McpHandlerOptions>) {
	const created = createMcpHandler({
		name: 'todo',
		version: '1.0.0',
		commands: [clear],
		...options,
	});
	created.dispose();
	return created;
}

function warnings(spy: { mock: { calls: unknown[][] } }): string[] {
	return spy.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('warning'));
}

const passThrough: CommandMiddleware = (_name, _input, _context, next) => next();

beforeEach(() => {
	// The warning is logged once per process: forget an earlier test's.
	Reflect.deleteProperty(globalThis, Symbol.for('dev.afd/instances-warning'));
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Post one MCP 2026-07-28 `tools/call` of todo-clear to `url`, with `extra` params. */
async function callClear(url: string, id: number, extra: object = {}) {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'MCP-Protocol-Version': '2026-07-28',
			'Mcp-Method': 'tools/call',
			'Mcp-Name': 'todo-clear',
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id,
			method: 'tools/call',
			params: {
				name: 'todo-clear',
				arguments: {},
				_meta: {
					'io.modelcontextprotocol/protocolVersion': '2026-07-28',
					'io.modelcontextprotocol/clientCapabilities': { elicitation: {} },
					'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '0' },
				},
				...extra,
			},
		}),
	});
	const text = await response.text();
	const data = /^data: (.*)$/m.exec(text)?.[1];
	return (JSON.parse(data ?? text) as { result: Record<string, unknown> }).result;
}

describe('confirmationKey', () => {
	it('is refused at creation when shorter than 32 bytes', () => {
		expect(() => handler({ confirmationKey: 'short' })).toThrow(
			new TypeError('confirmationKey must be at least 32 bytes')
		);
		expect(() => handler({ confirmationKey: new Uint8Array(31) })).toThrow(TypeError);
		expect(() => handler({ confirmationKey: 42 as unknown as string })).toThrow(
			'confirmationKey must be a string or Uint8Array'
		);
	});

	it("keeps its own copy: changing the caller's Buffer later does not change the key", async () => {
		const buffer = Buffer.from(KEY);
		const created = createMcpHandler({
			name: 'todo',
			version: '1.0.0',
			commands: [clear],
			toolStrategy: 'individual',
			confirmations: 'require-human',
			confirmationKey: buffer,
		});
		const server = createServer(created);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		try {
			const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
			const asked = await callClear(url, 1);
			expect(asked.resultType).toBe('input_required');
			buffer.fill(0);
			const retried = await callClear(url, 2, {
				inputResponses: { confirm: { action: 'accept', content: { confirm: true } } },
				requestState: asked.requestState,
			});
			expect(retried.resultType).not.toBe('input_required');
			expect(retried.isError).toBe(false);
		} finally {
			created.dispose();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it('accepts 32 bytes as a string or bytes', () => {
		expect(() => handler({ confirmationKey: KEY })).not.toThrow();
		expect(() => handler({ confirmationKey: new Uint8Array(32) })).not.toThrow();
	});
});

describe("instances: 'multiple'", () => {
	it('refuses confirmations without a shared confirmationKey', () => {
		expect(() => handler({ instances: 'multiple', confirmations: 'enforce' })).toThrow(
			/instances: 'multiple' needs confirmationKey/
		);
		expect(() =>
			handler({ instances: 'multiple', confirmations: 'enforce', confirmationKey: KEY })
		).not.toThrow();
	});

	it('refuses single-use approval middleware without a nonceStore', () => {
		const middleware = [createApprovalMiddleware({ secret: SECRET })];
		expect(() => handler({ instances: 'multiple', middleware })).toThrow(/nonceStore/);
		expect(() =>
			handler({
				instances: 'multiple',
				middleware: [createApprovalMiddleware({ secret: SECRET, nonceStore: sharedStore })],
			})
		).not.toThrow();
		// Tokens that may be reused within their TTL keep no nonces.
		expect(() =>
			handler({
				instances: 'multiple',
				middleware: [createApprovalMiddleware({ secret: SECRET, replay: 'within-ttl' })],
			})
		).not.toThrow();
	});

	it('refuses the approval relay without a shared confirmationKey', () => {
		const middleware = [
			createApprovalMiddleware({
				secret: SECRET,
				nonceStore: sharedStore,
				relay: 'mcp-elicitation',
			}),
		];
		expect(() => handler({ instances: 'multiple', middleware })).toThrow(/needs confirmationKey/);
		expect(() =>
			handler({ instances: 'multiple', middleware, confirmationKey: KEY })
		).not.toThrow();
	});

	it('names both defaults when both are missing, with what to supply', () => {
		expect(() =>
			handler({
				instances: 'multiple',
				confirmations: 'require-human',
				middleware: [createApprovalMiddleware({ secret: SECRET })],
			})
		).toThrow(/confirmationKey .* and the approval middleware's nonceStore .*Pass the same/);
	});

	it('sees approval middleware made by another installed copy of the package', async () => {
		vi.resetModules();
		const other = (await import('./approval.js')) as typeof import('./approval.js');
		expect(other.createApprovalMiddleware).not.toBe(createApprovalMiddleware);
		expect(() =>
			handler({
				instances: 'multiple',
				middleware: [other.createApprovalMiddleware({ secret: SECRET })],
			})
		).toThrow(/nonceStore/);
		expect(() =>
			handler({
				instances: 'multiple',
				middleware: [
					other.createApprovalMiddleware({
						secret: SECRET,
						relay: 'mcp-elicitation',
						nonceStore: sharedStore,
					}),
				],
			})
		).toThrow(/needs confirmationKey/);
	});

	it('sees approval middleware inside composeMiddleware', () => {
		const composed = composeMiddleware(passThrough, createApprovalMiddleware({ secret: SECRET }));
		expect(() => handler({ instances: 'multiple', middleware: [composed] })).toThrow(/nonceStore/);
		const nested = composeMiddleware(
			composeMiddleware(
				createApprovalMiddleware({
					secret: SECRET,
					nonceStore: sharedStore,
					relay: 'mcp-elicitation',
				})
			),
			passThrough
		);
		expect(() => handler({ instances: 'multiple', middleware: [nested] })).toThrow(
			/needs confirmationKey/
		);
		expect(() =>
			handler({ instances: 'multiple', middleware: [nested], confirmationKey: KEY })
		).not.toThrow();
		expect(() =>
			handler({ instances: 'multiple', middleware: [composeMiddleware(passThrough)] })
		).not.toThrow();
	});

	it("still validates a supplied key under instances: 'single'", () => {
		expect(() => handler({ instances: 'single', confirmationKey: 'short' })).toThrow(TypeError);
	});

	it('needs nothing when no per-process default is in use', () => {
		expect(() => handler({ instances: 'multiple' })).not.toThrow();
	});

	it('refuses an unknown value', () => {
		expect(() => handler({ instances: 'many' as 'multiple' })).toThrow(
			"instances must be 'single' or 'multiple'"
		);
	});
});

describe('the HTTP warning', () => {
	it('createMcpHandler warns once when it relies on a per-process default', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		handler({
			confirmations: 'enforce',
			middleware: [createApprovalMiddleware({ secret: SECRET })],
		});
		const lines = warnings(spy);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/\[todo\] warning: one process must serve every request/);
		expect(lines[0]).toMatch(/confirmationKey .* and the approval middleware's nonceStore/);
	});

	it("is silenced by instances: 'single', and absent when nothing is per process", () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		handler({ instances: 'single', confirmations: 'enforce' });
		handler({ confirmations: 'enforce', confirmationKey: KEY });
		handler({
			middleware: [createApprovalMiddleware({ secret: SECRET, nonceStore: sharedStore })],
		});
		handler({});
		expect(warnings(spy)).toEqual([]);
		// 'single' marks nothing: a later server that leaves instances out still warns.
		handler({ confirmations: 'enforce' });
		expect(warnings(spy)).toHaveLength(1);
	});

	it('is not silenced by an inherited property', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const key = Symbol.for('dev.afd/instances-warning');
		Object.defineProperty(Object.prototype, key, { value: true, configurable: true });
		try {
			handler({ confirmations: 'enforce' });
		} finally {
			Reflect.deleteProperty(Object.prototype, key);
		}
		expect(warnings(spy)).toHaveLength(1);
	});

	it('logs once per process, across handlers and an HTTP start', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		handler({ confirmations: 'enforce' });
		handler({ middleware: [createApprovalMiddleware({ secret: SECRET })] });
		const server = createMcpServer({
			name: 'todo',
			version: '1.0.0',
			commands: [clear],
			transport: 'http',
			host: '127.0.0.1',
			port: 0,
			confirmations: 'enforce',
		});
		await server.start();
		await server.stop();
		expect(warnings(spy)).toHaveLength(1);
	});

	it('logs nothing on stdio', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const server = createMcpServer({
			name: 'todo',
			version: '1.0.0',
			commands: [clear],
			transport: 'stdio',
			confirmations: 'enforce',
			middleware: [createApprovalMiddleware({ secret: SECRET })],
		});
		await server.start();
		await server.stop();
		expect(warnings(spy)).toEqual([]);
	});

	it('createMcpServer warns when it starts on HTTP, not when created', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const server = createMcpServer({
			name: 'todo',
			version: '1.0.0',
			commands: [clear],
			transport: 'http',
			host: '127.0.0.1',
			port: 0,
			confirmations: 'enforce',
		});
		expect(warnings(spy)).toEqual([]);
		await server.start();
		try {
			const lines = warnings(spy);
			expect(lines).toHaveLength(1);
			expect(lines[0]).toMatch(/no confirmationKey/);
		} finally {
			await server.stop();
		}
	});
});
