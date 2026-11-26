/**
 * The approver carrier beyond the shared vectors (`spec/vectors/approver-client.json`): the
 * 2025-era lane, failing predicates and unbindable credentials, the evidence taken once, a token
 * outside its approver's calls, and the HTTP routes.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApprovalMiddleware } from './approval.js';
import { AFD_APPROVAL_META_KEY, approvalKeyInInput, bindApprover } from './approver.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const SECRET = 'test-approver-secret-0123456789abcdef';
const SHELL = { issuer: 'https://auth.example.com', subject: 'person-1', clientId: 'loam-shell' };
const SHELL_ACTOR = { kind: 'agent' as const, id: 'loam-shell', onBehalfOf: 'person-1' };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function commands(runs: string[]) {
	return [
		defineCommand({
			name: 'todo-delete',
			description: 'Delete a todo',
			mutation: true,
			approval: 'required',
			expose: { mcp: true },
			input: z.object({ id: z.number() }),
			handler: async (input) => {
				runs.push(`delete:${input.id}`);
				return success({ deleted: input.id });
			},
		}),
		defineCommand({
			name: 'todo-list',
			description: 'List todos',
			expose: { mcp: true },
			input: z.object({}),
			handler: async () => {
				runs.push('list');
				return success([]);
			},
		}),
	];
}

async function serve(server: Partial<McpHandlerOptions> = {}) {
	const runs: string[] = [];
	const list = commands(runs);
	const errors: Error[] = [];
	const handler = createMcpHandler({
		name: 'approver-test',
		version: '1.0.0',
		commands: list,
		host: '127.0.0.1',
		toolStrategy: 'individual',
		createContext: () => ({ credentials: SHELL, actor: SHELL_ACTOR }),
		approver: () => true,
		onError: (error) => {
			errors.push(error);
		},
		middleware: [createApprovalMiddleware({ secret: SECRET, commands: list })],
		...server,
	});
	const http = createServer(handler);
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		http.closeAllConnections();
		await new Promise<void>((resolve) => http.close(() => resolve()));
	});
	return { base: `http://127.0.0.1:${(http.address() as AddressInfo).port}`, runs, errors };
}

async function connect(url: string, mode: 'auto' | 'legacy' = 'auto') {
	const client = new Client({ name: 'approver', version: '0' }, { versionNegotiation: { mode } });
	await client.connect(new StreamableHTTPClientTransport(new URL(url)));
	cleanups.push(() => client.close());
	return client;
}

function result(response: unknown): CommandResult {
	const content = (response as { content: Array<{ text: string }> }).content;
	return JSON.parse(content[0]?.text ?? '{}');
}

const token = (held: CommandResult) =>
	(held.error?.details as { approvalToken?: string } | undefined)?.approvalToken;

describe('the approver carrier', () => {
	it('gives an approver its token on a 2025-era request, and refuses the key there', async () => {
		const { base, runs } = await serve();
		const client = await connect(`${base}/mcp`, 'legacy');
		const held = result(await client.callTool({ name: 'todo-delete', arguments: { id: 7 } }));
		expect(held.error?.code).toBe('APPROVAL_REQUIRED');
		const approval = token(held);
		expect(approval).toMatch(/^afdap1\./);
		const retry = result(
			await client.callTool({
				name: 'todo-delete',
				arguments: { id: 7 },
				_meta: { [AFD_APPROVAL_META_KEY]: approval },
			})
		);
		expect(retry.error?.code).toBe('APPROVAL_REQUIRED');
		expect(retry.error?.message).toContain('one command');
		// A person approves the held call; the approved call resent the wrong way is the caller's
		// to reshape, which no command does (spec/recovery.md, "Engine errors").
		expect(held.error?.recovery).toEqual({ kind: 'external' });
		expect(retry.error).not.toHaveProperty('recovery');
		expect(runs).toEqual([]);
	});

	it('refuses the key under a __proto__ member on a 2025-era request, before the SDK drops it', async () => {
		const { base, runs } = await serve();
		const client = await connect(`${base}/mcp`, 'legacy');
		const args = JSON.parse(`{"id":7,"__proto__":{"${AFD_APPROVAL_META_KEY}":"x"}}`);
		const refused = result(await client.callTool({ name: 'todo-delete', arguments: args }));
		expect(refused.error?.code).toBe('VALIDATION_ERROR');
		expect(runs).toEqual([]);
	});

	it('fails the call when the predicate throws, and never takes it as a yes', async () => {
		const { base, runs, errors } = await serve({
			approver: () => {
				throw new Error('directory down');
			},
		});
		const client = await connect(`${base}/mcp`);
		await expect(client.callTool({ name: 'todo-delete', arguments: { id: 7 } })).rejects.toThrow();
		expect(errors.map((error) => error.message)).toContain('directory down');
		expect(runs).toEqual([]);
	});

	it('makes no approver of credentials that cannot be bound (M8)', async () => {
		const { base, runs } = await serve({
			createContext: () => ({ credentials: { ...SHELL, clientId: '' }, actor: SHELL_ACTOR }),
		});
		const client = await connect(`${base}/mcp`);
		await expect(client.callTool({ name: 'todo-delete', arguments: { id: 7 } })).rejects.toThrow();
		expect(runs).toEqual([]);
	});

	it('refuses the key in the HTTP routes’ input', async () => {
		const { base, runs } = await serve();
		const rpc = await fetch(`${base}/rpc`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'todo-list',
				params: { nested: { [AFD_APPROVAL_META_KEY]: 'x' } },
			}),
		});
		expect(((await rpc.json()) as { result: CommandResult }).result.error?.code).toBe(
			'VALIDATION_ERROR'
		);
		const batch = await fetch(`${base}/batch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				commands: [{ command: 'todo-list', input: { [AFD_APPROVAL_META_KEY]: 'x' } }],
			}),
		});
		expect(((await batch.json()) as CommandResult).error?.code).toBe('VALIDATION_ERROR');
		const stream = await fetch(`${base}/stream/todo-list`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ nested: [{ [AFD_APPROVAL_META_KEY]: 'x' }] }),
		});
		expect(await stream.text()).toContain('VALIDATION_ERROR');
		const message = await fetch(`${base}/message`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'todo-delete', arguments: { id: 7, [AFD_APPROVAL_META_KEY]: 'x' } },
			}),
		});
		const answered = (await message.json()) as { result: unknown };
		expect(result(answered.result).error?.code).toBe('VALIDATION_ERROR');
		expect(runs).toEqual([]);
	});

	it('gives an approver its token on the 2025-era /message lane, and refuses the key there', async () => {
		const { base, runs } = await serve();
		const message = async (meta: Record<string, unknown>) => {
			const response = await fetch(`${base}/message`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: 'todo-delete', arguments: { id: 7 }, _meta: meta },
				}),
			});
			return result(((await response.json()) as { result: unknown }).result);
		};
		const held = await message({});
		expect(held.error?.code).toBe('APPROVAL_REQUIRED');
		const approval = token(held);
		expect(approval).toMatch(/^afdap1\./);
		const retry = await message({ [AFD_APPROVAL_META_KEY]: approval });
		expect(retry.error?.code).toBe('APPROVAL_REQUIRED');
		expect(retry.error?.message).toContain('one command');
		expect(runs).toEqual([]);
	});

	it('decides an approver on the HTTP routes as on /message: its token, and its key refused (#1743)', async () => {
		const { base, runs } = await serve();
		const post = (path: string, body: unknown) =>
			fetch(`${base}${path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
		const rpc = async (meta: Record<string, unknown>) => {
			const response = await post('/rpc', {
				jsonrpc: '2.0',
				id: 1,
				method: 'todo-delete',
				params: { id: 7, _meta: meta },
			});
			return ((await response.json()) as { result: CommandResult }).result;
		};
		const held = await rpc({});
		expect(held.error?.code).toBe('APPROVAL_REQUIRED');
		const approval = token(held);
		expect(approval).toMatch(/^afdap1\./);
		const meta = { [AFD_APPROVAL_META_KEY]: approval };

		const retried = await rpc(meta);
		expect(retried.error).toMatchObject({ code: 'APPROVAL_REQUIRED', retryable: false });
		expect(retried.error?.message).toContain('one command');

		const batch = (await (
			await post('/batch', {
				commands: [{ command: 'todo-delete', input: { id: 7 } }],
				_meta: meta,
			})
		).json()) as CommandResult;
		expect(batch.error).toMatchObject({ code: 'APPROVAL_REQUIRED', retryable: false });

		const stream = await (await post('/stream/todo-delete', { id: 7, _meta: meta })).text();
		const chunk = JSON.parse(/^data: (.*)$/m.exec(stream)?.[1] ?? 'null');
		expect(chunk).toMatchObject({
			type: 'error',
			error: { code: 'APPROVAL_REQUIRED', retryable: false },
			recoverable: false,
		});
		expect(runs).toEqual([]);
	});

	it('still asks a caller that is not an approver with the relay', async () => {
		const runs: string[] = [];
		const list = commands(runs);
		const { base } = await serve({
			approver: () => false,
			middleware: [
				createApprovalMiddleware({ secret: SECRET, commands: list, relay: 'mcp-elicitation' }),
			],
		});
		const response = await fetch(`${base}/mcp`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				'MCP-Protocol-Version': '2026-07-28',
				'Mcp-Method': 'tools/call',
				'Mcp-Name': 'todo-delete',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'todo-delete',
					arguments: { id: 7 },
					_meta: {
						'io.modelcontextprotocol/protocolVersion': '2026-07-28',
						'io.modelcontextprotocol/clientCapabilities': { elicitation: {} },
						'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '0' },
					},
				},
			}),
		});
		const text = await response.text();
		const body = JSON.parse(/^data: (.*)$/m.exec(text)?.[1] ?? text) as {
			result?: { resultType?: string; inputRequests?: Record<string, unknown> };
		};
		expect(body.result?.resultType).toBe('input_required');
		expect(Object.keys(body.result?.inputRequests ?? {})).toEqual(['approval']);
	});
});

describe('the approval middleware on an approver’s call', () => {
	const runs: string[] = [];
	const list = commands(runs);
	const middleware = createApprovalMiddleware({
		secret: SECRET,
		commands: list,
		includeToken: false,
	});
	const base: CommandContext = { interface: 'mcp', actor: SHELL_ACTOR, credentials: SHELL };
	const next = async () => success('ran');

	it('issues the token whatever includeToken says, bound to the principal', async () => {
		const held = await middleware('todo-delete', { id: 7 }, bindApprover(base, {}), next);
		const approval = token(held);
		expect(approval).toMatch(/^afdap1\./);
		// The same token set by trusted host code on a call that is not an approver's.
		const outside = await middleware(
			'todo-delete',
			{ id: 7 },
			{ ...base, approval, interface: 'mcp' },
			next
		);
		expect(outside.error?.details?.reason).toBe('actor-mismatch');
		// As the host's evidence on the approver's own call, it holds.
		const host = await middleware(
			'todo-delete',
			{ id: 7 },
			bindApprover({ ...base, approval }, {}),
			next
		);
		expect(host.success).toBe(true);
	});

	it('lets the first command checked take the carried evidence, once', async () => {
		const held = await middleware('todo-delete', { id: 7 }, bindApprover(base, {}), next);
		const context = bindApprover(base, { evidence: token(held) });
		// The command the call routes to takes it, even one that needs no approval.
		expect((await middleware('todo-list', {}, context, next)).success).toBe(true);
		// A command run after it in process never sees it.
		const nested = await middleware('todo-delete', { id: 7 }, context, next);
		expect(nested.error?.code).toBe('APPROVAL_REQUIRED');
		expect(nested.error?.details?.reason).toBeUndefined();
	});
});

describe('approvalKeyInInput', () => {
	it('finds the key at any depth and nowhere else', () => {
		expect(approvalKeyInInput({ a: [{ b: { [AFD_APPROVAL_META_KEY]: 1 } }] })?.code).toBe(
			'VALIDATION_ERROR'
		);
		expect(
			approvalKeyInInput({ a: AFD_APPROVAL_META_KEY, b: ['dev.afd/confirm'] })
		).toBeUndefined();
		const deep: Record<string, unknown> = {};
		let at = deep;
		for (let level = 0; level < 100_000; level += 1) {
			const inner: Record<string, unknown> = {};
			at.x = inner;
			at = inner;
		}
		at[AFD_APPROVAL_META_KEY] = 1;
		expect(approvalKeyInInput(deep)?.code).toBe('VALIDATION_ERROR');
		// A `__proto__` member that a parser turned into the prototype is still input.
		const hidden = Object.create({ [AFD_APPROVAL_META_KEY]: 'x' }) as Record<string, unknown>;
		hidden.id = 1;
		expect(approvalKeyInInput({ a: hidden })?.code).toBe('VALIDATION_ERROR');
		expect(approvalKeyInInput(JSON.parse('{"__proto__":{"dev.afd/approval":1}}'))?.code).toBe(
			'VALIDATION_ERROR'
		);
	});
});
