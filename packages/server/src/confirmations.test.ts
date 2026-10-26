/**
 * Confirmation enforcement (`spec/command-metadata.md`, "Confirmations"): elicitation through
 * MCP 2026-07-28 `input_required`, the acknowledgement fallback, and the HTTP routes.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { confirmationBinding, createConfirmationGate } from './confirmations.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const MODERN = '2026-07-28';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function commands(calls: string[]) {
	return [
		defineCommand({
			name: 'todo-clear',
			description: 'Delete every todo',
			mutation: true,
			destructive: true,
			confirmPrompt: 'Delete every todo?',
			expose: { mcp: true },
			input: z.object({ scope: z.string().default('all') }).strict(),
			handler: async (input) => {
				calls.push(`clear:${input.scope}`);
				return success({ cleared: input.scope });
			},
		}),
		defineCommand({
			name: 'todo-list',
			description: 'List todos',
			expose: { mcp: true },
			input: z.object({}),
			handler: async () => {
				calls.push('list');
				return success([]);
			},
		}),
		defineCommand({
			name: 'todo-wipe',
			description: 'Wipe, with its own confirm field',
			mutation: true,
			confirmPrompt: 'Wipe?',
			expose: { mcp: true },
			input: z.object({ confirm: z.literal(true) }),
			handler: async () => {
				calls.push('wipe');
				return success({ wiped: true });
			},
		}),
	];
}

async function serve(options: Partial<McpHandlerOptions> = {}) {
	const calls: string[] = [];
	const handler = createMcpHandler({
		name: 'confirm-test',
		version: '1.0.0',
		commands: commands(calls),
		host: '127.0.0.1',
		toolStrategy: 'individual',
		confirmations: 'enforce',
		...options,
	});
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { base, url: `${base}/mcp`, calls };
}

type Answer = 'accept' | 'decline' | 'cancel' | 'unchecked';

async function connect(url: string, answer?: Answer, prompts: string[] = []) {
	const client = new Client(
		{ name: 'confirm-client', version: '0' },
		{
			versionNegotiation: { mode: 'auto' },
			...(answer && { capabilities: { elicitation: { form: {} } } }),
		}
	);
	if (answer) {
		client.setRequestHandler('elicitation/create', async (request) => {
			prompts.push(String((request.params as { message?: string }).message));
			if (answer === 'accept') return { action: 'accept', content: { confirm: true } };
			if (answer === 'unchecked') return { action: 'accept', content: { confirm: false } };
			return { action: answer };
		});
	}
	await client.connect(new StreamableHTTPClientTransport(new URL(url)));
	cleanups.push(() => client.close());
	return client;
}

function body(result: unknown): Record<string, unknown> {
	const content = (result as { content: Array<{ text: string }> }).content;
	return JSON.parse(content[0]?.text ?? '{}');
}

function errorCode(result: unknown): unknown {
	const parsed = body(result) as {
		error?: { code?: string };
		steps?: Array<{ error?: { code?: string } }>;
		results?: Array<{ result?: { error?: { code?: string } } }>;
	};
	return (
		parsed.error?.code ?? parsed.steps?.[0]?.error?.code ?? parsed.results?.[0]?.result?.error?.code
	);
}

async function post(url: string, payload: unknown, headers: Record<string, string> = {}) {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			...headers,
		},
		body: JSON.stringify(payload),
	});
	const text = await response.text();
	const data = /^data: (.*)$/m.exec(text)?.[1];
	return { status: response.status, json: JSON.parse(data ?? text) as Record<string, unknown> };
}

describe('confirmation gate', () => {
	it('binds a confirmation to the commands and their input, whatever the key order', () => {
		const a = confirmationBinding([{ command: 'x', input: { a: 1, b: { c: 2, d: 3 } } }]);
		const b = confirmationBinding([{ command: 'x', input: { b: { d: 3, c: 2 }, a: 1 } }]);
		const c = confirmationBinding([{ command: 'x', input: { a: 2, b: { c: 2, d: 3 } } }]);
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});

	it('rejects an unknown mode', () => {
		expect(() => createConfirmationGate('always' as never, [])).toThrow(/confirmations/);
	});
});

describe('confirmations over MCP', () => {
	it('advertises confirm only on gated tools that do not declare it, and only under enforce', async () => {
		const { url } = await serve();
		const tools = Object.fromEntries(
			(await (await connect(url)).listTools()).tools.map((tool) => [tool.name, tool])
		);
		const props = (name: string) =>
			(tools[name]?.inputSchema as { properties?: Record<string, unknown> } | undefined)
				?.properties;
		expect(props('todo-clear')).toHaveProperty('confirm');
		expect(props('todo-list')).not.toHaveProperty('confirm');
		expect(props('todo-wipe')?.confirm).toMatchObject({ const: true });

		const off = await serve({ confirmations: 'off' });
		const offTools = (await (await connect(off.url)).listTools()).tools;
		const clear = offTools.find((tool) => tool.name === 'todo-clear');
		expect(
			(clear?.inputSchema as { properties?: object } | undefined)?.properties
		).not.toHaveProperty('confirm');
	});

	it('runs a gated command when the user accepts the elicitation', async () => {
		const { url, calls } = await serve();
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({ name: 'todo-clear', arguments: { scope: 'done' } });
		expect(result.isError).toBe(false);
		expect(body(result)).toMatchObject({ success: true, data: { cleared: 'done' } });
		expect(prompts).toEqual(['Delete every todo?']);
		expect(calls).toEqual(['clear:done']);
	});

	it.each([
		['decline', 'decline'],
		['cancel', 'cancel'],
		['an unchecked box', 'unchecked'],
	] as const)('refuses with CONFIRMATION_DECLINED on %s', async (_label, answer) => {
		const { url, calls } = await serve();
		const result = await (await connect(url, answer)).callTool({
			name: 'todo-clear',
			arguments: {},
		});
		expect(result.isError).toBe(true);
		expect(body(result).error).toMatchObject({
			code: 'CONFIRMATION_DECLINED',
			retryable: false,
			details: { commands: ['todo-clear'] },
		});
		expect(calls).toEqual([]);
	});

	it('needs an acknowledgement from a client without elicitation, and strips it', async () => {
		const { url, calls } = await serve();
		const client = await connect(url);
		const refused = await client.callTool({ name: 'todo-clear', arguments: {} });
		expect(body(refused).error).toMatchObject({
			code: 'CONFIRMATION_REQUIRED',
			message: "'todo-clear' needs confirmation: Delete every todo?",
		});
		expect((body(refused).error as { suggestion: string }).suggestion).toContain('confirm: true');
		expect(calls).toEqual([]);

		// The schema is strict, so the call would fail validation if `confirm` reached it.
		const ran = await client.callTool({ name: 'todo-clear', arguments: { confirm: true } });
		expect(body(ran)).toMatchObject({ success: true, data: { cleared: 'all' } });
		const viaMeta = await client.callTool({
			name: 'todo-clear',
			arguments: {},
			_meta: { 'dev.afd/confirm': true },
		});
		expect(body(viaMeta).success).toBe(true);
		expect(calls).toEqual(['clear:all', 'clear:all']);
	});

	it('leaves a command-declared confirm field in the input', async () => {
		const { url, calls } = await serve();
		const client = await connect(url);
		const ran = await client.callTool({ name: 'todo-wipe', arguments: { confirm: true } });
		expect(body(ran)).toMatchObject({ success: true });
		expect(calls).toEqual(['wipe']);
	});

	it('does not accept an acknowledgement under require-human', async () => {
		const { url, calls } = await serve({ confirmations: 'require-human' });
		const result = await (await connect(url)).callTool({
			name: 'todo-clear',
			arguments: { confirm: true },
		});
		expect(body(result).error).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
		expect((body(result).error as { suggestion: string }).suggestion).toContain('elicitation');
		expect(calls).toEqual([]);

		const accepted = await (await connect(url, 'accept')).callTool({
			name: 'todo-clear',
			arguments: {},
		});
		expect(body(accepted).success).toBe(true);
	});

	it('does not gate anything when confirmations are off', async () => {
		const { url, calls } = await serve({ confirmations: 'off' });
		const result = await (await connect(url)).callTool({ name: 'todo-clear', arguments: {} });
		expect(body(result).success).toBe(true);
		expect(calls).toEqual(['clear:all']);
	});

	it('gates afd-call, afd-batch and afd-pipe before any step runs', async () => {
		const { url, calls } = await serve();
		const client = await connect(url);

		const call = await client.callTool({
			name: 'afd-call',
			arguments: { command: 'todo-clear', input: {} },
		});
		expect(errorCode(call)).toBe('CONFIRMATION_REQUIRED');
		const callOk = await client.callTool({
			name: 'afd-call',
			arguments: { command: 'todo-clear', input: {}, confirm: true },
		});
		expect(body(callOk).success).toBe(true);

		const batchArgs = {
			commands: [
				{ command: 'todo-list', input: {} },
				{ command: 'todo-clear', input: {} },
			],
		};
		const batch = await client.callTool({ name: 'afd-batch', arguments: batchArgs });
		expect(batch.isError).toBe(true);
		expect(errorCode(batch)).toBe('CONFIRMATION_REQUIRED');
		expect(calls).toEqual(['clear:all']);
		const batchOk = await client.callTool({
			name: 'afd-batch',
			arguments: { ...batchArgs, confirm: ['todo-clear'] },
		});
		expect(body(batchOk)).toMatchObject({ success: true });

		const pipeArgs = { steps: [{ command: 'todo-list' }, { command: 'todo-clear' }] };
		const pipe = await client.callTool({ name: 'afd-pipe', arguments: pipeArgs });
		expect(errorCode(pipe)).toBe('CONFIRMATION_REQUIRED');
		const pipeOk = await client.callTool({
			name: 'afd-pipe',
			arguments: { ...pipeArgs, confirm: ['todo-clear'] },
		});
		expect(pipeOk.isError).toBe(false);
		expect(calls).toEqual(['clear:all', 'list', 'clear:all', 'list', 'clear:all']);
	});

	it('asks once for a batch, listing every gated command', async () => {
		const { url, calls } = await serve();
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({
			name: 'afd-batch',
			arguments: {
				commands: [
					{ command: 'todo-clear', input: { scope: 'a' } },
					{ command: 'todo-wipe', input: { confirm: true } },
				],
			},
		});
		expect(body(result)).toMatchObject({ success: true });
		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toContain('todo-clear: Delete every todo?');
		expect(prompts[0]).toContain('todo-wipe: Wipe?');
		expect(calls).toEqual(['clear:a', 'wipe']);
	});

	it('gates grouped tools', async () => {
		const { url, calls } = await serve({ toolStrategy: 'grouped' });
		const client = await connect(url);
		const tool = (await client.listTools()).tools.find((item) => item.name === 'todo');
		expect((tool?.inputSchema as { properties?: object } | undefined)?.properties).toHaveProperty(
			'confirm'
		);
		const refused = await client.callTool({
			name: 'todo',
			arguments: { action: 'clear', params: {} },
		});
		expect(errorCode(refused)).toBe('CONFIRMATION_REQUIRED');
		const ran = await client.callTool({
			name: 'todo',
			arguments: { action: 'clear', params: {}, confirm: true },
		});
		expect(body(ran).success).toBe(true);
		expect(calls).toEqual(['clear:all']);
	});

	it('does not reuse a confirmation for other input, or a tampered requestState', async () => {
		const { url, calls } = await serve();
		const envelope = {
			'io.modelcontextprotocol/protocolVersion': MODERN,
			'io.modelcontextprotocol/clientCapabilities': { elicitation: {} },
			'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '0' },
		};
		const headers = {
			'MCP-Protocol-Version': MODERN,
			'Mcp-Method': 'tools/call',
			'Mcp-Name': 'todo-clear',
		};
		const call = (id: number, args: object, extra: object = {}) =>
			post(
				url,
				{
					jsonrpc: '2.0',
					id,
					method: 'tools/call',
					params: { name: 'todo-clear', arguments: args, _meta: envelope, ...extra },
				},
				headers
			);
		const first = await call(1, { scope: 'a' });
		const asked = first.json.result as { resultType: string; requestState: string };
		expect(asked.resultType).toBe('input_required');
		const accepted = { confirm: { action: 'accept', content: { confirm: true } } };

		// Same state and answer, different input: asked again, nothing runs.
		const other = await call(
			2,
			{ scope: 'b' },
			{
				inputResponses: accepted,
				requestState: asked.requestState,
			}
		);
		expect((other.json.result as { resultType: string }).resultType).toBe('input_required');
		const tampered = await call(
			3,
			{ scope: 'a' },
			{
				inputResponses: accepted,
				requestState: `${asked.requestState.slice(0, -2)}xx`,
			}
		);
		expect((tampered.json.result as { resultType: string }).resultType).toBe('input_required');
		expect(calls).toEqual([]);

		const matching = await call(
			4,
			{ scope: 'a' },
			{
				inputResponses: accepted,
				requestState: asked.requestState,
			}
		);
		expect((matching.json.result as { isError: boolean }).isError).toBe(false);
		expect(calls).toEqual(['clear:a']);
	});

	it('elicits on a 2025-era stdio connection through the SDK shim', async () => {
		const calls: string[] = [];
		const { serveModernStdio } = await import('./mcp-modern.js');
		const { createToolRouter } = await import('./tool-router.js');
		const { createExecutionEngine } = await import('./execution.js');
		const { getToolsList } = await import('./tools.js');
		const list = commands(calls);
		const engine = createExecutionEngine({
			commandMap: new Map(list.map((command) => [command.name, command])),
			middleware: [],
			devMode: false,
		});
		const gate = createConfirmationGate('enforce', list);
		const routeToolCall = createToolRouter({
			executeCommand: engine.executeCommand,
			executeBatch: engine.executeBatch,
			executePipeline: engine.executePipeline,
			commands: list,
			toolStrategy: 'individual',
			devMode: false,
			confirmations: gate,
		});
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const handle = serveModernStdio(
			{
				name: 'stdio-confirm',
				version: '1.0.0',
				instructions: '',
				getToolsList: () => getToolsList(list, 'individual', undefined, undefined, {}),
				routeToolCall,
				devMode: false,
			},
			undefined,
			serverSide
		);
		const prompts: string[] = [];
		const client = new Client(
			{ name: 'legacy', version: '0' },
			{ capabilities: { elicitation: { form: {} } } }
		);
		client.setRequestHandler('elicitation/create', async (request) => {
			prompts.push(String((request.params as { message?: string }).message));
			return { action: 'accept', content: { confirm: true } };
		});
		await client.connect(clientSide);
		cleanups.push(async () => {
			await client.close();
			await handle.close();
		});
		const result = await client.callTool({ name: 'todo-clear', arguments: {} });
		expect(body(result)).toMatchObject({ success: true });
		expect(prompts).toEqual(['Delete every todo?']);
		expect(calls).toEqual(['clear:all']);
	});
});

describe('confirmations on the HTTP routes', () => {
	it('gates /rpc, /batch and /stream, acknowledged by Afd-Confirm', async () => {
		const { base, calls } = await serve();
		const rpc = await post(`${base}/rpc`, {
			jsonrpc: '2.0',
			id: 1,
			method: 'todo-clear',
			params: {},
		});
		expect(rpc.json.result).toMatchObject({
			success: false,
			error: { code: 'CONFIRMATION_REQUIRED' },
		});
		expect((rpc.json.result as { error: { suggestion: string } }).error.suggestion).toContain(
			'Afd-Confirm: todo-clear'
		);
		const rpcOk = await post(
			`${base}/rpc`,
			{ jsonrpc: '2.0', id: 2, method: 'todo-clear', params: {} },
			{ 'Afd-Confirm': 'todo-clear' }
		);
		expect(rpcOk.json.result).toMatchObject({ success: true });

		const batch = await post(`${base}/batch`, { commands: [{ command: 'todo-clear', input: {} }] });
		expect(batch.json).toMatchObject({ success: false, error: { code: 'CONFIRMATION_REQUIRED' } });
		const batchOk = await post(
			`${base}/batch`,
			{ commands: [{ command: 'todo-clear', input: {} }] },
			{ 'Afd-Confirm': 'todo-list, todo-clear' }
		);
		expect(batchOk.json).toMatchObject({ success: true });

		const stream = await post(`${base}/stream/todo-clear`, {});
		expect(stream.json).toMatchObject({ type: 'error', error: { code: 'CONFIRMATION_REQUIRED' } });
		expect(calls).toEqual(['clear:all', 'clear:all']);
	});
});
