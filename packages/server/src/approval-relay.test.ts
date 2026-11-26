/**
 * The MCP approval relay (#418): `createApprovalMiddleware({ relay: 'mcp-elicitation' })` asks the
 * human behind the MCP client through a form elicitation, and an agent cannot approve its own call.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CommandResult } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
	type ApprovalMiddlewareOptions,
	type ApprovalRequest,
	createApprovalMiddleware,
} from './approval.js';
import {
	type ApprovalAnswer,
	type ApprovalHold,
	type ApprovalQuestion,
	type ApprovalRelay,
	type ApprovedStep,
	approvalRelay,
	bindApprovalRelay,
	bindUpFrontApproval,
	type StepsHold,
	upFrontApproval,
	withoutApprovalRelay,
} from './approval-relay.js';
import { createUpFrontApproval, MAX_KEPT_INPUT } from './approval-up-front.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

/**
 * `state` with one signature character changed. The last character of a base64url HMAC-SHA256
 * carries only four bits, so rewriting it can decode to the same bytes (about once in 1,024
 * runs); the character before it carries six.
 */
function tamper(state: string): string {
	const at = state.length - 2;
	return `${state.slice(0, at)}${state[at] === 'A' ? 'B' : 'A'}${state.slice(at + 1)}`;
}

const MODERN = '2026-07-28';
const SECRET = 'test-approval-secret-0123456789abcdef';
const TTL_MS = 60_000;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function commands(calls: string[]) {
	return [
		defineCommand({
			name: 'todo-delete',
			description: 'Delete a todo permanently',
			mutation: true,
			destructive: true,
			approval: 'required',
			expose: { mcp: true },
			// Not strict: unknown arguments are stripped by validation.
			input: z.object({ id: z.number() }),
			handler: async (input) => {
				calls.push(`delete:${input.id}`);
				return success({ deleted: input.id });
			},
		}),
		defineCommand({
			name: 'todo-delete-strict',
			description: 'Delete, with a strict schema',
			mutation: true,
			approval: 'required',
			expose: { mcp: true },
			input: z.object({ id: z.number() }).strict(),
			handler: async (input) => {
				calls.push(`strict:${input.id}`);
				return success({ deleted: input.id });
			},
		}),
		defineCommand({
			name: 'todo-clear',
			description: 'Delete every todo',
			mutation: true,
			destructive: true,
			confirmPrompt: 'Delete every todo?',
			approval: 'required',
			expose: { mcp: true },
			input: z.object({}),
			handler: async () => {
				calls.push('clear');
				return success({ cleared: true });
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
	];
}

interface Setup {
	middleware?: Partial<ApprovalMiddlewareOptions>;
	server?: Partial<McpHandlerOptions>;
	/** Commands served besides the usual ones. */
	extra?: (calls: string[]) => ReturnType<typeof commands>;
}

/** A clock the tests move: approvals expire on the middleware's clock. */
function movableClock() {
	let now = Date.parse('2026-10-26T12:00:00.000Z');
	return {
		now: () => now,
		advance(ms: number) {
			now += ms;
		},
	};
}

async function serve(setup: Setup = {}) {
	const calls: string[] = [];
	const requests: ApprovalRequest[] = [];
	const clock = movableClock();
	const list = [...commands(calls), ...(setup.extra?.(calls) ?? [])];
	const handler = createMcpHandler({
		name: 'approval-relay-test',
		version: '1.0.0',
		commands: list,
		host: '127.0.0.1',
		toolStrategy: 'individual',
		middleware: [
			createApprovalMiddleware({
				secret: SECRET,
				commands: list,
				ttlMs: TTL_MS,
				clock,
				relay: 'mcp-elicitation',
				onApprovalRequired: (request) => {
					requests.push(request);
				},
				...setup.middleware,
			}),
		],
		...setup.server,
	});
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { url: `${base}/mcp`, calls, requests, clock };
}

type Answer = 'accept' | 'decline' | 'cancel' | 'unchecked';

/**
 * An MCP client whose human answers every elicitation with `answer` (no elicitation capability
 * when `answer` is left out). `prompts` records each question with its form fields.
 */
async function connect(
	url: string,
	answer?: Answer,
	prompts: string[] = [],
	mode: 'auto' | 'legacy' = 'auto'
) {
	const client = new Client(
		{ name: 'relay-client', version: '0' },
		{
			versionNegotiation: { mode },
			...(answer && { capabilities: { elicitation: { form: {} } } }),
		}
	);
	if (answer) {
		client.setRequestHandler('elicitation/create', async (request) => {
			const params = request.params as {
				message?: string;
				requestedSchema?: { properties?: Record<string, unknown> };
			};
			const field = Object.keys(params.requestedSchema?.properties ?? {})[0] ?? '';
			prompts.push(`${field}: ${params.message}`);
			if (answer === 'accept') return { action: 'accept', content: { [field]: true } };
			if (answer === 'unchecked') return { action: 'accept', content: { [field]: false } };
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

function error(result: unknown) {
	return body(result).error as
		| {
				code: string;
				suggestion: string;
				retryable?: boolean;
				details?: Record<string, unknown>;
				recovery?: unknown;
		  }
		| undefined;
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
	return JSON.parse(data ?? text) as { result?: Record<string, unknown>; error?: unknown };
}

/** Raw modern `tools/call`s from a client that declares form elicitation. */
function rawCaller(url: string) {
	let id = 0;
	return (tool: string, args: object, extra: object = {}, meta: object = {}) =>
		post(
			url,
			{
				jsonrpc: '2.0',
				id: ++id,
				method: 'tools/call',
				params: {
					name: tool,
					arguments: args,
					_meta: {
						'io.modelcontextprotocol/protocolVersion': MODERN,
						'io.modelcontextprotocol/clientCapabilities': { elicitation: {} },
						'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '0' },
						...meta,
					},
					...extra,
				},
			},
			{ 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/call', 'Mcp-Name': tool }
		);
}

const approved = { approval: { action: 'accept', content: { approve: true } } };

interface StatePayload {
	p: Array<Record<string, unknown>>;
	a: Array<Record<string, unknown>>;
}

/** Re-encode a `requestState` with an edited payload, keeping its original MAC. */
function editState(state: string, edit: (payload: StatePayload) => StatePayload): string {
	const dot = state.lastIndexOf('.');
	const prefix = state.slice(0, 3);
	const envelope = JSON.parse(Buffer.from(state.slice(3, dot), 'base64url').toString('utf8'));
	const body = Buffer.from(JSON.stringify({ ...envelope, p: edit(envelope.p) })).toString(
		'base64url'
	);
	return `${prefix}${body}${state.slice(dot)}`;
}

function asked(response: { result?: Record<string, unknown> }) {
	const result = response.result as {
		resultType?: string;
		requestState?: string;
		inputRequests?: Record<string, { params?: { message?: string } }>;
	};
	return result;
}

describe('approval relay over MCP', () => {
	it('asks the human through the client and runs the call once they approve', async () => {
		const { url, calls, requests } = await serve();
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({ name: 'todo-delete', arguments: { id: 7 } });
		expect(body(result)).toMatchObject({ success: true, data: { deleted: 7 } });
		expect(prompts).toEqual(['approve: Run todo-delete\n\nCommand: todo-delete\nInput: {"id":7}']);
		expect(calls).toEqual(['delete:7']);
		// No token was issued on the relay path.
		expect(requests).toEqual([]);
	});

	it('never puts an approval token on the wire', async () => {
		const { url } = await serve();
		const first = await rawCaller(url)('todo-delete', { id: 1 });
		const text = JSON.stringify(first);
		expect(asked(first).resultType).toBe('input_required');
		expect(asked(first).inputRequests?.approval?.params?.message).toBe(
			'Run todo-delete\n\nCommand: todo-delete\nInput: {"id":1}'
		);
		expect(text).not.toContain('afdap1');
	});

	it.each(['decline', 'cancel', 'unchecked'] as const)(
		'fails without running when the human answers %s',
		async (answer) => {
			const { url, calls } = await serve();
			const client = await connect(url, answer);
			const result = await client.callTool({ name: 'todo-delete', arguments: { id: 7 } });
			expect(error(result)).toMatchObject({
				code: 'APPROVAL_REQUIRED',
				retryable: false,
				details: { reason: 'declined', summary: 'Run todo-delete' },
			});
			// The human chose not to proceed: no step makes the call succeed.
			expect(error(result)?.recovery).toEqual({ kind: 'stop' });
			expect(error(result)?.details).not.toHaveProperty('approvalToken');
			expect(calls).toEqual([]);
		}
	);

	it('asks for the confirmation, then the approval, keeping the first answer', async () => {
		const { url, calls } = await serve({ server: { confirmations: 'require-human' } });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({ name: 'todo-clear', arguments: {} });
		expect(body(result)).toMatchObject({ success: true });
		expect(prompts).toEqual([
			'confirm: Delete every todo?',
			'approve: Delete every todo?\n\nCommand: todo-clear\nInput: {}',
		]);
		expect(calls).toEqual(['clear']);
	});

	it('elicits on a 2025-era stdio connection through the SDK shim', async () => {
		const calls: string[] = [];
		const list = commands(calls);
		const { serveModernStdio } = await import('./mcp-modern.js');
		const { createToolRouter } = await import('./tool-router.js');
		const { createExecutionEngine } = await import('./execution.js');
		const { getToolsList } = await import('./tools.js');
		const engine = createExecutionEngine({
			commandMap: new Map(list.map((command) => [command.name, command])),
			middleware: [
				createApprovalMiddleware({ secret: SECRET, commands: list, relay: 'mcp-elicitation' }),
			],
			devMode: false,
		});
		const routeToolCall = createToolRouter({
			executeCommand: engine.executeCommand,
			executeBatch: engine.executeBatch,
			executePipeline: engine.executePipeline,
			commands: list,
			toolStrategy: 'individual',
			devMode: false,
		});
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const handle = serveModernStdio(
			{
				name: 'stdio-approval',
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
			return { action: 'accept', content: { approve: true } };
		});
		await client.connect(clientSide);
		cleanups.push(async () => {
			await client.close();
			await handle.close();
		});
		expect(client.getProtocolEra()).toBe('legacy');
		const result = await client.callTool({ name: 'todo-delete', arguments: { id: 3 } });
		expect(body(result)).toMatchObject({ success: true });
		expect(prompts).toEqual(['Run todo-delete\n\nCommand: todo-delete\nInput: {"id":3}']);
		expect(calls).toEqual(['delete:3']);
		// A batch is asked about once, up front, the same way.
		const batch = await client.callTool({
			name: 'afd-batch',
			arguments: {
				commands: [
					{ command: 'todo-list', input: {} },
					{ command: 'todo-delete', input: { id: 4 } },
				],
			},
		});
		expect(body(batch)).toMatchObject({ success: true });
		expect(prompts[1]).toMatch(/^This batch includes a step that needs your approval/);
		expect(calls).toEqual(['delete:3', 'list', 'delete:4']);
	});

	describe('falls back to APPROVAL_REQUIRED without a token', () => {
		it('when the client declares no elicitation', async () => {
			const { url, calls, requests } = await serve();
			const client = await connect(url);
			const result = await client.callTool({ name: 'todo-delete', arguments: { id: 7 } });
			expect(error(result)?.code).toBe('APPROVAL_REQUIRED');
			expect(error(result)?.details).not.toHaveProperty('approvalToken');
			expect(error(result)?.suggestion).toContain('supports form elicitation');
			// The application still receives the token, out of band.
			expect(requests).toHaveLength(1);
			expect(requests[0]?.approvalToken).toMatch(/^afdap1\./);
			expect(calls).toEqual([]);
		});

		it('on a 2025-era HTTP request, which has no back channel', async () => {
			const { url, calls } = await serve();
			const client = await connect(url, 'accept', [], 'legacy');
			expect(client.getProtocolEra()).toBe('legacy');
			const result = await client.callTool({ name: 'todo-delete', arguments: { id: 7 } });
			expect(error(result)?.code).toBe('APPROVAL_REQUIRED');
			expect(error(result)?.details).not.toHaveProperty('approvalToken');
			expect(calls).toEqual([]);
		});

		it('when the relay is off', async () => {
			const { url, calls } = await serve({ middleware: { relay: 'none' } });
			const prompts: string[] = [];
			const client = await connect(url, 'accept', prompts);
			const result = await client.callTool({ name: 'todo-delete', arguments: { id: 7 } });
			expect(error(result)?.code).toBe('APPROVAL_REQUIRED');
			expect(error(result)?.details).not.toHaveProperty('approvalToken');
			expect(prompts).toEqual([]);
			expect(calls).toEqual([]);
		});

		it('for afd-batch and afd-pipe steps when the client declares no elicitation', async () => {
			const { url, calls } = await serve();
			const client = await connect(url);
			const batch = await client.callTool({
				name: 'afd-batch',
				arguments: {
					commands: [
						{ command: 'todo-list', input: {} },
						{ command: 'todo-delete', input: { id: 1 } },
					],
				},
			});
			const results = body(batch).results as Array<{ result: CommandResult }>;
			expect(results[1]?.result.error?.code).toBe('APPROVAL_REQUIRED');
			expect(results[1]?.result.error?.details).not.toHaveProperty('approvalToken');
			expect(results[1]?.result.error?.suggestion).toContain(
				'Call todo-delete from an MCP client that supports form elicitation'
			);
			const pipe = await client.callTool({
				name: 'afd-pipe',
				arguments: {
					steps: [{ command: 'todo-list' }, { command: 'todo-delete', input: { id: 1 } }],
				},
			});
			const steps = body(pipe).steps as Array<{ error?: { code: string } }>;
			expect(steps[1]?.error?.code).toBe('APPROVAL_REQUIRED');
			expect(calls).toEqual(['list', 'list']);
		});

		it('keeps the token in the result when includeToken is set explicitly', async () => {
			const { url } = await serve({ middleware: { includeToken: true } });
			const client = await connect(url);
			const result = await client.callTool({ name: 'todo-delete', arguments: { id: 7 } });
			expect(error(result)?.details?.approvalToken).toMatch(/^afdap1\./);
		});
	});

	describe('an agent cannot approve its own call', () => {
		it('ignores approval fields and a valid token in the tool arguments', async () => {
			const { url, calls, requests } = await serve();
			const client = await connect(url);
			await client.callTool({ name: 'todo-delete', arguments: { id: 7 } });
			const token = requests[0]?.approvalToken as string;
			expect(token).toMatch(/^afdap1\./);

			const smuggled = {
				id: 7,
				approval: token,
				approvalToken: token,
				approve: true,
				confirm: true,
			};
			const loose = await client.callTool({ name: 'todo-delete', arguments: smuggled });
			expect(error(loose)?.code).toBe('APPROVAL_REQUIRED');
			// The carrier's key is never input: in the arguments, at any depth, it is refused.
			const keyed = await client.callTool({
				name: 'todo-delete',
				arguments: { ...smuggled, _meta: { 'dev.afd/approval': token } },
			});
			expect(error(keyed)?.code).toBe('VALIDATION_ERROR');
			const viaCall = await client.callTool({
				name: 'afd-call',
				arguments: { command: 'todo-delete', input: smuggled, confirm: true },
			});
			expect(error(viaCall)?.code).toBe('APPROVAL_REQUIRED');
			const strict = await client.callTool({
				name: 'todo-delete-strict',
				arguments: { id: 7, approval: token },
			});
			expect(error(strict)?.code).toBe('VALIDATION_ERROR');
			expect(calls).toEqual([]);
		});

		it('ignores approval keys and the confirm acknowledgement in request _meta', async () => {
			const { url, calls } = await serve();
			const call = rawCaller(url);
			const response = await call(
				'todo-delete',
				{ id: 7 },
				{},
				{ 'dev.afd/confirm': true, 'dev.afd/approval': true, 'dev.afd/approve': true }
			);
			expect(asked(response).resultType).toBe('input_required');
			expect(calls).toEqual([]);
		});

		it('does not accept an approval answer without a valid requestState', async () => {
			const { url, calls } = await serve();
			const call = rawCaller(url);
			const first = asked(await call('todo-delete', { id: 7 }));
			const state = first.requestState as string;

			const none = await call('todo-delete', { id: 7 }, { inputResponses: approved });
			expect(asked(none).resultType).toBe('input_required');
			const tampered = await call(
				'todo-delete',
				{ id: 7 },
				{ inputResponses: approved, requestState: tamper(state) }
			);
			expect(asked(tampered).resultType).toBe('input_required');
			// The state is readable, not writable: marking the approval accepted, or extending its
			// expiry, breaks the MAC.
			const promoted = await call(
				'todo-delete',
				{ id: 7 },
				{ requestState: editState(state, (payload) => ({ p: [], a: payload.p })) }
			);
			expect(asked(promoted).resultType).toBe('input_required');
			const extended = await call(
				'todo-delete',
				{ id: 7 },
				{
					inputResponses: approved,
					requestState: editState(state, (payload) => ({
						...payload,
						p: payload.p.map((item) => ({ ...item, x: Number.MAX_SAFE_INTEGER })),
					})),
				}
			);
			expect(asked(extended).resultType).toBe('input_required');
			expect(calls).toEqual([]);

			const genuine = await call(
				'todo-delete',
				{ id: 7 },
				{ inputResponses: approved, requestState: state }
			);
			expect((genuine.result as { isError?: boolean }).isError).toBe(false);
			expect(calls).toEqual(['delete:7']);
		});

		it('does not reuse an approval for another input or another command', async () => {
			const { url, calls } = await serve();
			const call = rawCaller(url);
			const state = asked(await call('todo-delete', { id: 7 })).requestState as string;
			const other = await call(
				'todo-delete',
				{ id: 8 },
				{ inputResponses: approved, requestState: state }
			);
			expect(asked(other).resultType).toBe('input_required');
			const otherCommand = await call(
				'todo-delete-strict',
				{ id: 7 },
				{ inputResponses: approved, requestState: state }
			);
			expect(asked(otherCommand).resultType).toBe('input_required');
			expect(calls).toEqual([]);
		});

		it('does not take an approval asked of one principal from another (#532)', async () => {
			// Test-only header: a real createContext reads identity something verified.
			const { url, calls } = await serve({
				server: {
					createContext: (req) => {
						const caller = req.headers['x-test-caller'];
						return typeof caller === 'string' ? JSON.parse(caller) : {};
					},
				},
			});
			const caller = {
				actor: { kind: 'agent', id: 'todo-agent', onBehalfOf: 'user-1' },
				credentials: {
					issuer: 'https://auth.example.com',
					subject: 'user-1',
					clientId: 'todo-agent',
				},
			};
			let id = 0;
			const call = (as: object, extra: object = {}) =>
				post(
					url,
					{
						jsonrpc: '2.0',
						id: ++id,
						method: 'tools/call',
						params: {
							name: 'todo-delete',
							arguments: { id: 7 },
							_meta: {
								'io.modelcontextprotocol/protocolVersion': MODERN,
								'io.modelcontextprotocol/clientCapabilities': { elicitation: {} },
								'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '0' },
							},
							...extra,
						},
					},
					{
						'MCP-Protocol-Version': MODERN,
						'Mcp-Method': 'tools/call',
						'Mcp-Name': 'todo-delete',
						'X-Test-Caller': JSON.stringify(as),
					}
				);
			const state = asked(await call(caller)).requestState as string;
			const retry = { inputResponses: approved, requestState: state };
			for (const other of [
				{ ...caller, actor: { ...caller.actor, id: 'other-agent' } },
				{ ...caller, credentials: { ...caller.credentials, issuer: 'https://other.example.com' } },
				{ ...caller, credentials: { ...caller.credentials, subject: 'user-2' } },
				{ ...caller, credentials: { ...caller.credentials, clientId: 'other-agent' } },
			]) {
				expect(asked(await call(other, retry)).resultType).toBe('input_required');
			}
			expect(calls).toEqual([]);
			const genuine = await call(caller, retry);
			expect((genuine.result as { isError?: boolean }).isError).toBe(false);
			expect(calls).toEqual(['delete:7']);
		});

		it('does not replay an approved requestState: an approval runs the call once', async () => {
			const { url, calls } = await serve();
			const call = rawCaller(url);
			const state = asked(await call('todo-delete', { id: 7 })).requestState as string;
			const retry = { inputResponses: approved, requestState: state };
			const first = await call('todo-delete', { id: 7 }, retry);
			expect((first.result as { isError?: boolean }).isError).toBe(false);
			const replay = await call('todo-delete', { id: 7 }, retry);
			expect(asked(replay).resultType).toBe('input_required');
			expect(calls).toEqual(['delete:7']);
		});

		it('does not take a confirmation answer as an approval', async () => {
			const { url, calls } = await serve({ server: { confirmations: 'require-human' } });
			const call = rawCaller(url);
			const confirmState = asked(await call('todo-clear', {})).requestState as string;
			// The confirmation's state, answered under the approval key, is not an approval: the
			// confirmation is still unanswered, so it is asked again.
			const swapped = await call(
				'todo-clear',
				{},
				{ inputResponses: approved, requestState: confirmState }
			);
			expect(asked(swapped).inputRequests).toHaveProperty('confirm');
			// Confirmed: now the approval is asked, and a confirm answer does not satisfy it.
			const confirmed = asked(
				await call(
					'todo-clear',
					{},
					{
						inputResponses: { confirm: { action: 'accept', content: { confirm: true } } },
						requestState: confirmState,
					}
				)
			);
			expect(confirmed.inputRequests).toHaveProperty('approval');
			const wrongField = await call(
				'todo-clear',
				{},
				{
					inputResponses: { approval: { action: 'accept', content: { confirm: true } } },
					requestState: confirmed.requestState,
				}
			);
			expect(error(wrongField.result)?.details).toMatchObject({ reason: 'declined' });
			expect(error(wrongField.result)?.recovery).toEqual({ kind: 'stop' });
			expect(calls).toEqual([]);
		});

		it('does not keep an earlier answer alive by carrying it into new rounds', async () => {
			const { url, calls } = await serve({ server: { confirmations: 'require-human' } });
			const call = rawCaller(url);
			const start = Date.now();
			const now = vi.spyOn(Date, 'now');
			try {
				now.mockReturnValue(start);
				const confirmState = asked(await call('todo-clear', {})).requestState as string;
				// Confirmed 6 minutes in: the approval is asked, carrying the confirmation.
				now.mockReturnValue(start + 6 * 60_000);
				const approval = asked(
					await call(
						'todo-clear',
						{},
						{
							inputResponses: { confirm: { action: 'accept', content: { confirm: true } } },
							requestState: confirmState,
						}
					)
				);
				expect(approval.inputRequests).toHaveProperty('approval');
				// 12 minutes in, the state itself is still valid, but the confirmation, asked 12
				// minutes ago, has lapsed: it is asked again rather than counted.
				now.mockReturnValue(start + 12 * 60_000);
				const late = asked(
					await call(
						'todo-clear',
						{},
						{ inputResponses: approved, requestState: approval.requestState }
					)
				);
				expect(late.inputRequests).toHaveProperty('confirm');
			} finally {
				now.mockRestore();
			}
			expect(calls).toEqual([]);
		});

		it('asks again when the approval expired before the answer came back', async () => {
			const { url, calls, clock } = await serve();
			const call = rawCaller(url);
			const state = asked(await call('todo-delete', { id: 7 })).requestState as string;
			clock.advance(TTL_MS);
			const late = await call(
				'todo-delete',
				{ id: 7 },
				{ inputResponses: approved, requestState: state }
			);
			expect(asked(late).resultType).toBe('input_required');
			expect(asked(late).inputRequests?.approval?.params?.message).toMatch(
				/^The earlier approval expired or was already used/
			);
			const fresh = asked(late).requestState as string;
			const onTime = await call(
				'todo-delete',
				{ id: 7 },
				{ inputResponses: approved, requestState: fresh }
			);
			expect((onTime.result as { isError?: boolean }).isError).toBe(false);
			expect(calls).toEqual(['delete:7']);
		});
	});
});

/** The error of a batch or pipeline refused before any step ran. */
function refusal(result: unknown) {
	const payload = body(result) as {
		error?: {
			code: string;
			message: string;
			suggestion: string;
			details?: object;
			recovery?: unknown;
		};
		steps?: Array<{
			index: number;
			error?: { code: string; suggestion: string; details?: object; recovery?: unknown };
		}>;
	};
	return payload.error ?? payload.steps?.find((step) => step.index === -1)?.error;
}

const BATCH = {
	commands: [
		{ command: 'todo-list', input: {} },
		{ command: 'todo-delete', input: { id: 1 } },
		{ command: 'todo-delete-strict', input: { id: 2 } },
	],
};

const BATCH_QUESTION = [
	'This batch includes 2 steps that need your approval. Approving lets each run once, exactly as shown; if you do not approve, nothing in the batch runs.',
	'',
	'Step 2: Run todo-delete',
	'Command: todo-delete',
	'Input: {"id":1}',
	'',
	'Step 3: Run todo-delete-strict',
	'Command: todo-delete-strict',
	'Input: {"id":2}',
].join('\n');

describe('a held call on an input with no canonical form', () => {
	/** todo-tag needs approval, and its validated input holds a Set, which canonical JSON refuses. */
	const tagged = (calls: string[]) =>
		[
			defineCommand({
				name: 'todo-tag',
				description: 'Tag a todo',
				mutation: true,
				approval: 'required',
				expose: { mcp: true },
				input: z.object({ tags: z.array(z.string()).transform((tags) => new Set(tags)) }),
				handler: async () => {
					calls.push('tag');
					return success({ tagged: true });
				},
			}),
		] as unknown as ReturnType<typeof commands>;

	function expectNotCanonical(
		refused: { code: string; details?: object; recovery?: unknown } | undefined
	) {
		expect(refused).toMatchObject({
			code: 'APPROVAL_UNAVAILABLE',
			retryable: false,
			details: { reason: 'input-not-canonical' },
		});
		// The caller sends the input in another form, which no command does.
		expect(refused?.recovery).toBeUndefined();
	}

	it('is answered on its own without asking the client', async () => {
		const { url, calls, requests } = await serve({ extra: tagged });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({ name: 'todo-tag', arguments: { tags: ['a'] } });
		expectNotCanonical(error(result));
		expect(prompts).toEqual([]);
		expect(requests).toEqual([]);
		expect(calls).toEqual([]);
	});

	it('refuses an afd-batch with such a step up front, running nothing', async () => {
		const { url, calls } = await serve({ extra: tagged });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({
			name: 'afd-batch',
			arguments: {
				commands: [
					{ command: 'todo-list', input: {} },
					{ command: 'todo-tag', input: { tags: ['a'] } },
				],
			},
		});
		expectNotCanonical(refusal(result));
		expect(prompts).toEqual([]);
		expect(calls).toEqual([]);
	});

	it('refuses an afd-pipe with such a step up front, running nothing', async () => {
		const { url, calls } = await serve({ extra: tagged });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({
			name: 'afd-pipe',
			arguments: {
				steps: [{ command: 'todo-list' }, { command: 'todo-tag', input: { tags: ['a'] } }],
			},
		});
		expectNotCanonical(refusal(result));
		expect(prompts).toEqual([]);
		expect(calls).toEqual([]);
	});
});

describe('an up-front step whose policy changes its input', () => {
	/** todo-tag needs approval, and its policy function changes the input it decides on. */
	const changing = (calls: string[]) =>
		[
			defineCommand({
				name: 'todo-tag',
				description: 'Tag a todo',
				mutation: true,
				approval: (input: { tag: string }) => {
					input.tag = 'changed';
					return 'required' as const;
				},
				expose: { mcp: true },
				input: z.object({ tag: z.string() }),
				handler: async () => {
					calls.push('tag');
					return success({ tagged: true });
				},
			}),
		] as unknown as ReturnType<typeof commands>;

	it('refuses the afd-batch up front, asking nobody and running nothing', async () => {
		const { url, calls, requests } = await serve({ extra: changing });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({
			name: 'afd-batch',
			arguments: {
				commands: [
					{ command: 'todo-list', input: {} },
					{ command: 'todo-tag', input: { tag: 'a' } },
				],
			},
		});
		expect(refusal(result)).toMatchObject({
			code: 'APPROVAL_UNAVAILABLE',
			retryable: false,
			details: { reason: 'admission-mismatch' },
		});
		// The operator fixes the approval setup.
		expect(refusal(result)?.recovery).toEqual({ kind: 'external' });
		expect(prompts).toEqual([]);
		expect(requests).toEqual([]);
		expect(calls).toEqual([]);
	});
});

describe('one up-front approval for afd-batch and afd-pipe (#459)', () => {
	it('asks once for every gated step of a batch, then runs it', async () => {
		const { url, calls, requests } = await serve();
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({ name: 'afd-batch', arguments: BATCH });
		expect(body(result)).toMatchObject({ success: true });
		expect(prompts).toEqual([`approve: ${BATCH_QUESTION}`]);
		// Nothing ran before the answer: the ungated step ran once.
		expect(calls).toEqual(['list', 'delete:1', 'strict:2']);
		expect(requests).toEqual([]);
	});

	it("decides every step from the server's commands when the middleware lists none", async () => {
		const { url, calls } = await serve({ middleware: { commands: [] } });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({ name: 'afd-batch', arguments: BATCH });
		expect(body(result)).toMatchObject({ success: true });
		expect(prompts).toEqual([`approve: ${BATCH_QUESTION}`]);
		expect(calls).toEqual(['list', 'delete:1', 'strict:2']);
	});

	it('runs nothing of a dynamic gated pipeline step when the middleware lists no commands', async () => {
		const { url, calls } = await serve({ middleware: { commands: [] } });
		const client = await connect(url, 'accept');
		const result = await client.callTool({
			name: 'afd-pipe',
			arguments: {
				steps: [{ command: 'todo-list' }, { command: 'todo-delete', input: { id: '$prev.count' } }],
			},
		});
		expect(refusal(result)).toMatchObject({
			code: 'APPROVAL_REQUIRED',
			details: { reason: 'input-not-known' },
		});
		// The caller splits the pipeline, which no command does.
		expect(refusal(result)?.recovery).toBeUndefined();
		expect(calls).toEqual([]);
	});

	it('asks for a pipeline whose gated steps read only $input, then runs it', async () => {
		const { url, calls } = await serve();
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({
			name: 'afd-pipe',
			arguments: {
				input: { target: 4 },
				steps: [
					{ command: 'todo-list' },
					{ command: 'todo-delete', input: { id: '$input.target' } },
				],
			},
		});
		expect((body(result).steps as Array<{ status: string }>).map((step) => step.status)).toEqual([
			'success',
			'success',
		]);
		expect(prompts).toEqual([
			'approve: This pipeline includes a step that needs your approval. Approving lets each run once, exactly as shown; if you do not approve, nothing in the pipeline runs.\n\nStep 2: Run todo-delete\nCommand: todo-delete\nInput: {"id":4}',
		]);
		expect(calls).toEqual(['list', 'delete:4']);
	});

	it('runs a batch with no gated step without asking', async () => {
		const { url, calls } = await serve();
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({
			name: 'afd-pipe',
			arguments: {
				steps: [{ command: 'todo-list' }, { command: 'todo-list', input: { from: '$prev' } }],
			},
		});
		expect(body(result).steps).toHaveLength(2);
		expect(prompts).toEqual([]);
		expect(calls).toEqual(['list', 'list']);
	});

	it('runs two identical gated steps, each on its own approval', async () => {
		const { url, calls } = await serve();
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const step = { command: 'todo-delete', input: { id: 1 } };
		const result = await client.callTool({
			name: 'afd-batch',
			arguments: { commands: [step, step] },
		});
		expect(body(result)).toMatchObject({ success: true });
		expect(prompts[0]).toMatch(/^approve: This batch includes 2 steps/);
		expect(calls).toEqual(['delete:1', 'delete:1']);
	});

	it.each(['decline', 'cancel', 'unchecked'] as const)(
		'runs nothing when the human answers %s',
		async (answer) => {
			const { url, calls } = await serve();
			const client = await connect(url, answer);
			const batch = await client.callTool({ name: 'afd-batch', arguments: BATCH });
			expect(refusal(batch)).toMatchObject({
				code: 'APPROVAL_REQUIRED',
				retryable: false,
				details: { reason: 'declined', summary: 'Run todo-delete; Run todo-delete-strict' },
			});
			expect(refusal(batch)?.recovery).toEqual({ kind: 'stop' });
			expect(body(batch).results).toEqual([]);
			const pipe = await client.callTool({
				name: 'afd-pipe',
				arguments: {
					steps: [{ command: 'todo-list' }, { command: 'todo-delete', input: { id: 1 } }],
				},
			});
			expect(refusal(pipe)).toMatchObject({
				code: 'APPROVAL_REQUIRED',
				details: { reason: 'declined' },
			});
			expect(refusal(pipe)?.recovery).toEqual({ kind: 'stop' });
			expect(calls).toEqual([]);
		}
	);

	it('asks again, running nothing, when the approval expired before the answer came back', async () => {
		const { url, calls, clock } = await serve();
		const call = rawCaller(url);
		const state = asked(await call('afd-batch', BATCH)).requestState as string;
		clock.advance(TTL_MS);
		const late = asked(
			await call('afd-batch', BATCH, { inputResponses: approved, requestState: state })
		);
		expect(late.resultType).toBe('input_required');
		expect(late.inputRequests?.approval?.params?.message).toBe(
			`The earlier approval expired, was already used or no longer matches; approve again to run it.\n${BATCH_QUESTION}`
		);
		expect(calls).toEqual([]);
		const onTime = await call('afd-batch', BATCH, {
			inputResponses: approved,
			requestState: late.requestState,
		});
		expect((onTime.result as { isError?: boolean }).isError).toBe(false);
		expect(calls).toEqual(['list', 'delete:1', 'strict:2']);
	});

	it('runs nothing and says where to split a pipeline whose gated step reads an earlier step', async () => {
		const { url, calls } = await serve();
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		for (const id of ['$prev.id', '$first', '$steps[0].id', '$steps.listed.id']) {
			const result = await client.callTool({
				name: 'afd-pipe',
				arguments: {
					steps: [
						{ command: 'todo-list', as: 'listed' },
						{ command: 'todo-delete', input: { id: 1 } },
						{ command: 'todo-delete', input: { id } },
					],
				},
			});
			const error = refusal(result);
			expect(error).toMatchObject({
				code: 'APPROVAL_REQUIRED',
				details: { reason: 'input-not-known', step: 2, command: 'todo-delete' },
			});
			expect(error?.suggestion).toContain('Split the pipeline before the step at index 2');
		}
		expect(prompts).toEqual([]);
		expect(calls).toEqual([]);
	});

	it('does not replay an approved requestState: the batch runs once', async () => {
		const { url, calls } = await serve();
		const call = rawCaller(url);
		const state = asked(await call('afd-batch', BATCH)).requestState as string;
		const retry = { inputResponses: approved, requestState: state };
		const first = await call('afd-batch', BATCH, retry);
		expect((first.result as { isError?: boolean }).isError).toBe(false);
		const replay = await call('afd-batch', BATCH, retry);
		expect(asked(replay).resultType).toBe('input_required');
		expect(calls).toEqual(['list', 'delete:1', 'strict:2']);
	});

	it('does not take an approval for changed input, another command or an extra step', async () => {
		const { url, calls } = await serve();
		const call = rawCaller(url);
		const state = asked(await call('afd-batch', BATCH)).requestState as string;
		const retry = { inputResponses: approved, requestState: state };
		const changes = [
			// Another input for an approved step.
			[BATCH.commands[0], { command: 'todo-delete', input: { id: 9 } }, BATCH.commands[2]],
			// The same input for another gated command.
			[BATCH.commands[0], { command: 'todo-delete-strict', input: { id: 1 } }, BATCH.commands[2]],
			// A second copy of an approved step needs its own approval.
			[...BATCH.commands, BATCH.commands[1]],
		];
		for (const commands of changes) {
			const changed = asked(await call('afd-batch', { commands }, retry));
			expect(changed.resultType).toBe('input_required');
		}
		expect(calls).toEqual([]);
		// The answer still holds for the batch it was given for.
		const original = await call('afd-batch', BATCH, retry);
		expect((original.result as { isError?: boolean }).isError).toBe(false);
		expect(calls).toEqual(['list', 'delete:1', 'strict:2']);
	});

	it('ignores approval fields in the arguments and _meta', async () => {
		const { url, calls } = await serve();
		const call = rawCaller(url);
		const forged = await call(
			'afd-batch',
			{
				commands: [{ command: 'todo-delete', input: { id: 1, approve: true, approval: true } }],
				confirm: ['todo-delete'],
			},
			{},
			{ 'dev.afd/approval': true, 'dev.afd/confirm': true }
		);
		expect(asked(forged).resultType).toBe('input_required');
		expect(calls).toEqual([]);
	});

	it('does not take an up-front approval in another call or on the single-command path', async () => {
		const { url, calls } = await serve();
		const call = rawCaller(url);
		const state = asked(await call('afd-batch', BATCH)).requestState as string;
		const retry = { inputResponses: approved, requestState: state };
		const elsewhere = [
			call('afd-pipe', { steps: [{ command: 'todo-delete-strict', input: { id: 2 } }] }, retry),
			call('todo-delete', { id: 1 }, retry),
			call('afd-batch', { commands: [...BATCH.commands].reverse() }, retry),
			call('afd-batch', { ...BATCH, options: { stopOnError: true } }, retry),
		];
		for (const response of await Promise.all(elsewhere)) {
			expect(asked(response).resultType).toBe('input_required');
		}
		expect(calls).toEqual([]);
		const original = await call('afd-batch', BATCH, retry);
		expect((original.result as { isError?: boolean }).isError).toBe(false);
		expect(calls).toEqual(['list', 'delete:1', 'strict:2']);
	});

	it('says when a pipeline has conditions that may skip a step', async () => {
		const { url } = await serve();
		const call = rawCaller(url);
		const pipe = {
			steps: [
				{ command: 'todo-list', as: 'listed' },
				{ command: 'todo-delete', input: { id: 1 }, when: { $exists: '$steps.listed' } },
			],
		};
		const question = asked(await call('afd-pipe', pipe)).inputRequests?.approval?.params?.message;
		expect(question?.split('\n').slice(0, 2)).toEqual([
			'This pipeline includes a step that needs your approval. Approving lets each run once, exactly as shown; if you do not approve, nothing in the pipeline runs.',
			'Some steps run only when their conditions hold, so one step may run while another is skipped.',
		]);
	});

	it('starts no approved step once its batch has timed out', async () => {
		const slow = {
			consume: async () => {
				await new Promise((resolve) => setTimeout(resolve, 100));
				return true;
			},
		};
		const { url, calls } = await serve({ middleware: { nonceStore: slow } });
		const call = rawCaller(url);
		const timed = {
			commands: [{ command: 'todo-delete', input: { id: 7 } }],
			options: { timeout: 30 },
		};
		const state = asked(await call('afd-batch', timed)).requestState as string;
		const result = await call('afd-batch', timed, {
			inputResponses: approved,
			requestState: state,
		});
		expect(JSON.stringify(result)).toContain('BATCH_TIMEOUT');
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(calls).toEqual([]);
	});

	it('starts neither ungated nor approved steps after their command deadlines pass', async () => {
		const calls: string[] = [];
		const list = commands(calls);
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		let completed = 0;
		let finished = () => {};
		let timeout: number | undefined;
		const approval = createApprovalMiddleware({
			secret: SECRET,
			commands: list,
			relay: 'mcp-elicitation',
			nonceStore: {
				consume: async () => {
					await blocked;
					return true;
				},
			},
		});
		const { url } = await serve({
			server: {
				commands: list,
				createContext: () => ({ timeout }),
				middleware: [
					async (name, input, context, next) => {
						try {
							return await approval(name, input, context, next);
						} finally {
							if (++completed === 2) finished();
						}
					},
				],
			},
		});
		const call = rawCaller(url);
		const batch = { commands: BATCH.commands.slice(0, 2) };
		const state = asked(await call('afd-batch', batch)).requestState as string;
		completed = 0;
		const settled = new Promise<void>((resolve) => {
			finished = resolve;
		});
		timeout = 20;
		try {
			const result = await call('afd-batch', batch, {
				inputResponses: approved,
				requestState: state,
			});
			expect(body(result.result)).toMatchObject({
				results: [
					{ result: { error: { code: 'TIMEOUT' } } },
					{ result: { error: { code: 'TIMEOUT' } } },
				],
			});
		} finally {
			release();
		}
		// Wait for the actual approval middleware to resume, including the ungated branch.
		await settled;
		expect(calls).toEqual([]);
	});

	it('names no hidden command and asks about at most 20 steps at once', async () => {
		const hidden = defineCommand({
			name: 'secret-wipe',
			description: 'Not exposed over MCP',
			approval: 'required',
			input: z.object({ id: z.unknown() }),
			handler: async () => success({}),
		});
		// Registered on the server and gated, but not exposed over MCP.
		const calls: string[] = [];
		const all = [...commands(calls), hidden];
		const { url } = await serve({ middleware: { commands: all }, server: { commands: all } });
		const client = await connect(url, 'accept');
		const pipe = await client.callTool({
			name: 'afd-pipe',
			arguments: {
				steps: [{ command: 'todo-list' }, { command: 'secret-wipe', input: { id: '$prev' } }],
			},
		});
		expect(JSON.stringify(body(pipe))).not.toContain('input-not-known');
		expect((body(pipe).steps as Array<{ error?: { code: string } }>)[1]?.error?.code).toBe(
			'COMMAND_NOT_FOUND'
		);
		const many = Array.from({ length: 21 }, (_, id) => ({ command: 'todo-delete', input: { id } }));
		const batch = await client.callTool({ name: 'afd-batch', arguments: { commands: many } });
		expect(refusal(batch)).toMatchObject({
			code: 'APPROVAL_REQUIRED',
			details: { reason: 'too-many-approvals', limit: 20 },
		});
		// The caller splits the batch, which no command does.
		expect(refusal(batch)?.recovery).toBeUndefined();
		expect(calls).toEqual(['list']);
	});

	it('asks for the confirmation, then the approval, keeping the first answer', async () => {
		const { url, calls } = await serve({ server: { confirmations: 'require-human' } });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({
			name: 'afd-batch',
			arguments: { commands: [{ command: 'todo-clear', input: {} }] },
		});
		expect(body(result)).toMatchObject({ success: true });
		expect(prompts).toHaveLength(2);
		expect(prompts[0]).toMatch(/^confirm: /);
		expect(prompts[1]).toBe(
			'approve: This batch includes a step that needs your approval. Approving lets each run once, exactly as shown; if you do not approve, nothing in the batch runs.\n\nStep 1: Delete every todo?\nCommand: todo-clear\nInput: {}'
		);
		expect(calls).toEqual(['clear']);
	});
});

describe('approval middleware with a relay', () => {
	const remove = {
		name: 'todo-delete',
		approval: 'required' as const,
	};

	/**
	 * A relay routed to `routed` that records holds and answers `answer` for the bindings it is
	 * asked about.
	 */
	function fakeRelay(
		answer: (bindings: readonly string[]) => ApprovalAnswer,
		routed = 'todo-delete'
	) {
		let claimed = false;
		const holds: ApprovalHold[] = [];
		const asked: string[][] = [];
		const relay: ApprovalRelay = {
			route() {},
			claim(command) {
				if (claimed || command !== routed) return false;
				claimed = true;
				return true;
			},
			answer: async (bindings) => {
				asked.push([...bindings]);
				return answer(bindings);
			},
			hold(hold) {
				holds.push(hold);
			},
			answers: async () => ({ accepted: [], declined: [] }),
			holdSteps() {},
		};
		return { holds, asked, relay, context: bindApprovalRelay({ interface: 'mcp' }, relay) };
	}

	const missing = (): ApprovalAnswer => ({ kind: 'missing' });
	const ran = (): Promise<CommandResult> => Promise.resolve(success('ran'));
	const accepting = (hold: ApprovalHold, edit: Partial<ApprovalHold> = {}) => {
		const { binding, nonce, expiresAt, mac } = { ...hold, ...edit };
		return (): ApprovalAnswer => ({ kind: 'accept', binding, nonce, expiresAt, mac });
	};

	async function heldOnce(secret: string | string[] = SECRET) {
		const middleware = createApprovalMiddleware({
			secret,
			commands: [remove],
			relay: 'mcp-elicitation',
		});
		const fake = fakeRelay(missing);
		await middleware('todo-delete', { id: 1 }, fake.context, ran);
		return fake.holds[0] as ApprovalHold;
	}

	it('gives the relay only to the routed command', async () => {
		const middleware = createApprovalMiddleware({
			secret: SECRET,
			commands: [remove, { name: 'todo-list' }],
			relay: 'mcp-elicitation',
		});
		// The routed command never reaches this middleware; a gated command its handler runs
		// cannot claim the relay, so the tool call is not turned into an elicitation.
		const fake = fakeRelay(missing, 'todo-list-elsewhere');
		const nested = await middleware('todo-delete', { id: 1 }, fake.context, ran);
		expect(nested.error?.suggestion).toContain('Call todo-delete on its own');
		// The caller reshapes the call, which no command does.
		expect(nested.error).not.toHaveProperty('recovery');
		// Routed and first: an ungated command claims it, so a gated one it runs cannot.
		const first = fakeRelay(missing, 'todo-list');
		await middleware('todo-list', {}, first.context, async () =>
			middleware('todo-delete', { id: 1 }, first.context, ran)
		);
		expect([...fake.holds, ...first.holds]).toEqual([]);
		expect([...fake.asked, ...first.asked]).toEqual([]);
	});

	it('holds with a binding per key, a MAC, and the input in the question', async () => {
		const middleware = createApprovalMiddleware({
			secret: [SECRET, `${SECRET}-old`],
			commands: [remove],
			relay: 'mcp-elicitation',
		});
		const fake = fakeRelay(missing);
		const result = await middleware('todo-delete', { id: 1 }, fake.context, ran);
		expect(result.error?.code).toBe('APPROVAL_REQUIRED');
		expect(result.error?.details).not.toHaveProperty('approvalToken');
		// The approval is pending: a person answers it.
		expect(result.error?.recovery).toEqual({ kind: 'external' });
		const [hold] = fake.holds;
		expect(fake.asked[0]).toHaveLength(2);
		expect(hold?.bindings).toEqual(fake.asked[0]);
		expect(hold?.binding).toBe(fake.asked[0]?.[0]);
		expect(hold?.nonce).toMatch(/^[\w-]{22}$/);
		expect(hold?.mac).toMatch(/^[\w-]{43}$/);
		expect(hold?.message).toBe('Run todo-delete\n\nCommand: todo-delete\nInput: {"id":1}');
	});

	it('runs a genuine accepted approval once', async () => {
		const middleware = createApprovalMiddleware({
			secret: SECRET,
			commands: [remove],
			relay: 'mcp-elicitation',
		});
		const first = fakeRelay(missing);
		await middleware('todo-delete', { id: 1 }, first.context, ran);
		const hold = first.holds[0] as ApprovalHold;
		const accepted = fakeRelay(accepting(hold));
		expect((await middleware('todo-delete', { id: 1 }, accepted.context, ran)).data).toBe('ran');
		const replay = fakeRelay(accepting(hold));
		expect((await middleware('todo-delete', { id: 1 }, replay.context, ran)).data).toBeUndefined();
		expect(replay.holds[0]?.message).toMatch(/^The earlier approval expired or was already used/);
	});

	it('does not run an approval whose nonce, expiry or MAC was not issued by the middleware', async () => {
		const hold = await heldOnce();
		const middleware = createApprovalMiddleware({
			secret: SECRET,
			commands: [remove],
			relay: 'mcp-elicitation',
		});
		const forgeries: Array<Partial<ApprovalHold>> = [
			{ nonce: 'fresh-nonce-0123456789' },
			{ expiresAt: hold.expiresAt + 1 },
			{ mac: hold.mac.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) },
			{ mac: '' },
		];
		for (const edit of forgeries) {
			const fake = fakeRelay(accepting(hold, edit));
			const result = await middleware('todo-delete', { id: 1 }, fake.context, ran);
			expect(result.data).toBeUndefined();
			expect(fake.holds).toHaveLength(1);
		}
		// Another secret's approval is not this one's.
		const otherHold = await heldOnce(`${SECRET}-other`);
		const fake = fakeRelay(accepting(otherHold));
		expect((await middleware('todo-delete', { id: 1 }, fake.context, ran)).data).toBeUndefined();
	});

	it('runs an approval asked under a key that has since rotated', async () => {
		const old = `${SECRET}-old`;
		const hold = await heldOnce(old);
		const rotated = createApprovalMiddleware({
			secret: [SECRET, old],
			commands: [remove],
			relay: 'mcp-elicitation',
		});
		const fake = fakeRelay(accepting(hold));
		expect((await rotated('todo-delete', { id: 1 }, fake.context, ran)).data).toBe('ran');
	});

	it('replaces the relay of afd-batch and afd-pipe steps with one that never asks', () => {
		const fake = fakeRelay(missing);
		expect(approvalRelay(fake.context)).toBe(fake.relay);
		const stripped = approvalRelay(withoutApprovalRelay(fake.context));
		expect(stripped).toBeDefined();
		expect(stripped).not.toBe(fake.relay);
		expect(stripped?.claim('todo-delete')).toBe(false);
		expect(approvalRelay(withoutApprovalRelay({}))).toBeUndefined();
		expect(approvalRelay({ ...fake.context })).toBe(fake.relay);
	});

	it('lets an up-front step take only an approval of its own input, once', async () => {
		const middleware = createApprovalMiddleware({
			secret: SECRET,
			commands: [remove],
			relay: 'mcp-elicitation',
		});
		const request = { commands: [{ command: 'todo-delete', input: { id: 1 } }] };
		let held: StepsHold | undefined;
		const asking = { ...fakeRelay(missing).relay, holdSteps: (hold: StepsHold) => (held = hold) };
		const first = bindUpFrontApproval(
			{ interface: 'mcp' },
			createUpFrontApproval(asking, 'afd-batch', request, commands([]))
		);
		expect((await middleware('todo-delete', { id: 1 }, first, ran)).success).toBe(false);
		const question = held?.questions[0] as ApprovalQuestion;
		const accepted = {
			...asking,
			answers: async () => ({
				accepted: [
					{
						binding: question.binding,
						nonce: question.nonce,
						expiresAt: question.expiresAt,
						mac: question.mac,
					},
				],
				declined: [],
			}),
		};
		const call = bindUpFrontApproval(
			{ interface: 'mcp' },
			createUpFrontApproval(accepted, 'afd-batch', request, commands([]))
		);
		// Each step runs with a context of its own, as the engine gives it.
		const step = () => ({ ...call });
		// Another input (say, from a handler's nested call) does not take the step's approval.
		const other = await middleware('todo-delete', { id: 2 }, step(), ran);
		expect(other.error?.code).toBe('APPROVAL_REQUIRED');
		const own = step();
		expect((await middleware('todo-delete', { id: 1 }, own, ran)).data).toBe('ran');
		// The handler's context no longer carries the up-front approval.
		expect(upFrontApproval(own)).toBeUndefined();
		const again = await middleware('todo-delete', { id: 1 }, step(), ran);
		expect(again.error?.code).toBe('APPROVAL_REQUIRED');
	});

	it('asks again when the input kept for a step is not the one its approval is bound to', async () => {
		const middleware = createApprovalMiddleware({
			secret: SECRET,
			commands: [remove],
			relay: 'mcp-elicitation',
		});
		const request = { commands: [{ command: 'todo-delete', input: { id: 1 } }] };
		let held: StepsHold | undefined;
		const asking = { ...fakeRelay(missing).relay, holdSteps: (hold: StepsHold) => (held = hold) };
		const first = bindUpFrontApproval(
			{ interface: 'mcp' },
			createUpFrontApproval(asking, 'afd-batch', request, commands([]))
		);
		expect((await middleware('todo-delete', { id: 1 }, first, ran)).success).toBe(false);
		const question = held?.questions[0] as ApprovalQuestion;
		expect(question.step).toMatchObject({ index: 0, input: '{"id":1}' });
		// A state that pairs the genuine approval of { id: 1 } with another kept input.
		held = undefined;
		const swapped = {
			...asking,
			answers: async () => ({
				accepted: [
					{
						binding: question.binding,
						nonce: question.nonce,
						expiresAt: question.expiresAt,
						mac: question.mac,
						step: { ...(question.step as ApprovedStep), input: '{"id":2}' },
					},
				],
				declined: [],
			}),
		};
		const upFront = createUpFrontApproval(swapped, 'afd-batch', request, commands([]));
		// The step takes the kept input, as the engine would give it to the middleware.
		const kept = await upFront.validated('todo-delete', { id: 1 });
		expect(kept).toEqual({ input: { id: 2 } });
		const call = bindUpFrontApproval({ interface: 'mcp' }, upFront);
		const result = await middleware('todo-delete', kept?.input, call, ran);
		// The approval is of { id: 1 }: nothing runs, and the human is asked about { id: 2 }.
		expect(result.error?.code).toBe('APPROVAL_REQUIRED');
		expect((held as StepsHold | undefined)?.questions[0]?.step?.input).toBe('{"id":2}');
	});

	it('gives the validated input only to a command that has an approval policy', async () => {
		const request = {
			commands: [
				{ command: 'todo-list', input: {} },
				{ command: 'todo-delete', input: { id: 1 } },
			],
		};
		const upFront = createUpFrontApproval(
			fakeRelay(missing).relay,
			'afd-batch',
			request,
			commands([])
		);
		expect(await upFront.validated('todo-list', {})).toBeUndefined();
		expect(await upFront.validated('todo-delete', { id: 2 })).toBeUndefined();
		expect(await upFront.validated('todo-delete', { id: 1 })).toEqual({ input: { id: 1 } });
		// Handed out once.
		expect(await upFront.validated('todo-delete', { id: 1 })).toBeUndefined();
	});

	it('rejects an unknown relay mode', () => {
		expect(() =>
			createApprovalMiddleware({
				secret: SECRET,
				commands: [remove],
				relay: 'auto' as never,
			})
		).toThrow(TypeError);
	});
});

/** A gated command whose schema defaults differ from one validation to the next. */
function noteAdd(calls: string[]) {
	return [
		defineCommand({
			name: 'note-add',
			description: 'Add a note',
			mutation: true,
			approval: 'required',
			expose: { mcp: true },
			input: z.object({
				text: z.string(),
				id: z.string().default(() => randomUUID()),
				at: z.string().default(() => new Date().toISOString()),
			}),
			handler: async (input) => {
				calls.push(`add:${input.id}:${input.at}`);
				return success({ id: input.id });
			},
		}),
	] as unknown as ReturnType<typeof commands>;
}

/** The `id` and `at` each gated step of a question was shown with, as `add:<id>:<at>`. */
function shown(message: string | undefined): string[] {
	return [...(message ?? '').matchAll(/^Input: (.*)$/gm)].map((match) => {
		const input = JSON.parse(match[1] as string) as { id: string; at: string };
		return `add:${input.id}:${input.at}`;
	});
}

describe('a step runs on the input approved up front (#1414)', () => {
	const NOTES = {
		commands: [
			{ command: 'todo-list', input: {} },
			{ command: 'note-add', input: { text: 'milk' } },
		],
	};

	it('runs a gated batch step whose schema defaults are random on the approved input', async () => {
		const { url, calls } = await serve({ extra: noteAdd });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({ name: 'afd-batch', arguments: NOTES });
		expect(body(result)).toMatchObject({ success: true });
		// Asked once; the ungated step ran once, and the gated one on the id and time shown.
		expect(prompts).toHaveLength(1);
		expect(shown(prompts[0])).toHaveLength(1);
		expect(calls).toEqual(['list', ...shown(prompts[0])]);
	});

	it('runs a gated pipeline step whose schema defaults are random on the approved input', async () => {
		const { url, calls } = await serve({ extra: noteAdd });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({
			name: 'afd-pipe',
			arguments: {
				input: { text: 'eggs' },
				steps: [{ command: 'todo-list' }, { command: 'note-add', input: { text: '$input.text' } }],
			},
		});
		expect((body(result).steps as Array<{ status: string }>).map((step) => step.status)).toEqual([
			'success',
			'success',
		]);
		expect(prompts).toHaveLength(1);
		expect(calls).toEqual(['list', ...shown(prompts[0])]);
	});

	it('runs two steps sent alike, each on its own approved input', async () => {
		const { url, calls } = await serve({ extra: noteAdd });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const step = { command: 'note-add', input: { text: 'milk' } };
		const result = await client.callTool({
			name: 'afd-batch',
			arguments: { commands: [step, step], options: { parallelism: 2 } },
		});
		expect(body(result)).toMatchObject({ success: true });
		const inputs = shown(prompts[0]);
		expect(new Set(inputs).size).toBe(2);
		expect([...calls].sort()).toEqual([...inputs].sort());
	});

	it('does not run an approved input in a request that differs from the one approved', async () => {
		const { url, calls } = await serve({ extra: noteAdd });
		const call = rawCaller(url);
		const first = asked(await call('afd-batch', NOTES));
		const [approvedInput] = shown(first.inputRequests?.approval?.params?.message);
		const other = {
			commands: [
				{ command: 'todo-list', input: {} },
				{ command: 'note-add', input: { text: 'bleach' } },
			],
		};
		const second = asked(
			await call('afd-batch', other, { inputResponses: approved, requestState: first.requestState })
		);
		// The human is asked about the new request, on an input of its own; nothing ran.
		expect(second.resultType).toBe('input_required');
		const message = second.inputRequests?.approval?.params?.message;
		expect(message).toContain('"text":"bleach"');
		expect(shown(message)).not.toContain(approvedInput);
		expect(calls).toEqual([]);
	});

	it('does not run an input altered in the request state', async () => {
		const { url, calls } = await serve({ extra: noteAdd });
		const call = rawCaller(url);
		const first = asked(await call('afd-batch', NOTES));
		const forged = editState(first.requestState as string, (payload) => ({
			...payload,
			p: payload.p.map((item) => ({
				...item,
				i: JSON.stringify({ ...JSON.parse(item.i as string), text: 'bleach' }),
			})),
		}));
		const second = asked(
			await call('afd-batch', NOTES, { inputResponses: approved, requestState: forged })
		);
		expect(second.resultType).toBe('input_required');
		expect(second.inputRequests?.approval?.params?.message).not.toContain('bleach');
		expect(calls).toEqual([]);
		// The untouched state still runs what was approved.
		const [approvedInput] = shown(first.inputRequests?.approval?.params?.message);
		const run = await call('afd-batch', NOTES, {
			inputResponses: approved,
			requestState: first.requestState,
		});
		expect((run.result as { isError?: boolean }).isError).toBe(false);
		expect(calls).toEqual(['list', approvedInput]);
	});

	it('refuses, running nothing, when the approved input is too long to keep (#1511)', async () => {
		const { url, calls } = await serve({ extra: noteAdd });
		const call = rawCaller(url);
		const long = {
			commands: [
				{ command: 'todo-list', input: {} },
				{ command: 'note-add', input: { text: 'x'.repeat(MAX_KEPT_INPUT) } },
			],
		};
		const first = asked(await call('afd-batch', long));
		expect(first.resultType).toBe('input_required');
		const second = await call('afd-batch', long, {
			inputResponses: approved,
			requestState: first.requestState,
		});
		// Validated again, the random default differs from the one approved, and it would differ
		// on every retry: a final refusal, not another question.
		expect(asked(second).resultType).not.toBe('input_required');
		const refused = body(second.result);
		expect(refused).toMatchObject({
			success: false,
			error: {
				code: 'APPROVAL_REQUIRED',
				details: { reason: 'input-not-kept', step: 1, command: 'note-add' },
			},
		});
		expect((refused.error as { suggestion: string }).suggestion).toContain(
			'Call note-add on its own'
		);
		expect(calls).toEqual([]);
	});

	it('asks again when the approval of a step too long to keep only expired', async () => {
		// The same long input validates to itself every time: an expired approval is asked about
		// again, and the answer that comes back in time runs it.
		const memo = (calls: string[]) =>
			[
				defineCommand({
					name: 'memo-add',
					description: 'Add a memo',
					mutation: true,
					approval: 'required',
					expose: { mcp: true },
					input: z.object({ text: z.string() }),
					handler: async (input) => {
						calls.push(`memo:${input.text.length}`);
						return success({ added: true });
					},
				}),
			] as unknown as ReturnType<typeof commands>;
		const { url, calls, clock } = await serve({ extra: memo });
		const call = rawCaller(url);
		const long = {
			commands: [{ command: 'memo-add', input: { text: 'x'.repeat(MAX_KEPT_INPUT) } }],
		};
		const state = asked(await call('afd-batch', long)).requestState as string;
		clock.advance(TTL_MS);
		const late = asked(
			await call('afd-batch', long, { inputResponses: approved, requestState: state })
		);
		expect(late.resultType).toBe('input_required');
		expect(calls).toEqual([]);
		const onTime = await call('afd-batch', long, {
			inputResponses: approved,
			requestState: late.requestState,
		});
		expect((onTime.result as { isError?: boolean }).isError).toBe(false);
		expect(calls).toEqual([`memo:${MAX_KEPT_INPUT}`]);
	});
});

/** Commands whose schema checks the store: an item must exist to be touched or wiped. */
function items(calls: string[]) {
	const store = new Set([1]);
	const existing = z.object({
		id: z.number().refine((id) => store.has(id), { message: 'No such item' }),
	});
	return [
		defineCommand({
			name: 'item-remove',
			description: 'Remove an item',
			mutation: true,
			expose: { mcp: true },
			input: z.object({ id: z.number() }),
			handler: async (input) => {
				store.delete(input.id);
				calls.push(`remove:${input.id}`);
				return success({ removed: input.id });
			},
		}),
		defineCommand({
			name: 'item-touch',
			description: 'Touch an item',
			mutation: true,
			expose: { mcp: true },
			input: existing,
			handler: async (input) => {
				calls.push(`touch:${input.id}`);
				return success({ touched: input.id });
			},
		}),
		defineCommand({
			name: 'item-wipe',
			description: 'Wipe an item',
			mutation: true,
			approval: 'required',
			expose: { mcp: true },
			input: existing,
			handler: async (input) => {
				calls.push(`wipe:${input.id}`);
				return success({ wiped: input.id });
			},
		}),
	] as unknown as ReturnType<typeof commands>;
}

/**
 * Slots whose default id reads the store: `slot-claim`'s id defaults to the next free one and must
 * be free, and `slot-take` takes one.
 */
function slots(calls: string[]) {
	const store = new Set([1]);
	const next = () => Math.max(...store) + 1;
	return [
		defineCommand({
			name: 'slot-take',
			description: 'Take a slot',
			mutation: true,
			expose: { mcp: true },
			input: z.object({ id: z.number() }),
			handler: async (input) => {
				store.add(input.id);
				calls.push(`take:${input.id}`);
				return success({ taken: input.id });
			},
		}),
		defineCommand({
			name: 'slot-claim',
			description: 'Claim the next free slot',
			mutation: true,
			approval: 'required',
			expose: { mcp: true },
			input: z.object({
				id: z
					.number()
					.default(next)
					.refine((id) => !store.has(id), { message: 'Slot taken' }),
			}),
			handler: async (input) => {
				calls.push(`claim:${input.id}`);
				return success({ claimed: input.id });
			},
		}),
	] as unknown as ReturnType<typeof commands>;
}

describe('a step is still validated when it runs (#1414)', () => {
	const codes = (result: unknown) =>
		(body(result).results as Array<{ result: { error?: { code: string } } }>).map(
			(item) => item.result.error?.code
		);

	it.each([
		['with the approval middleware', {}],
		['without an approval middleware', { server: { middleware: [] } }],
	])('fails a step whose schema an earlier step made false, %s', async (_what, setup) => {
		const { url, calls } = await serve({ extra: items, ...setup });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({
			name: 'afd-batch',
			arguments: {
				commands: [
					{ command: 'item-remove', input: { id: 1 } },
					{ command: 'item-touch', input: { id: 1 } },
				],
			},
		});
		expect(codes(result)).toEqual([undefined, 'VALIDATION_ERROR']);
		expect(prompts).toEqual([]);
		expect(calls).toEqual(['remove:1']);
	});

	it('fails an approved step whose schema an earlier step made false', async () => {
		const { url, calls } = await serve({ extra: items });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({
			name: 'afd-batch',
			arguments: {
				commands: [
					{ command: 'item-remove', input: { id: 1 } },
					{ command: 'item-wipe', input: { id: 1 } },
				],
			},
		});
		// Valid when the human was asked, and no longer when the step ran.
		expect(prompts).toHaveLength(1);
		expect(codes(result)).toEqual([undefined, 'VALIDATION_ERROR']);
		expect(calls).toEqual(['remove:1']);
	});

	it('fails an approved step whose approved input, not only the input sent, an earlier step made invalid (#1511)', async () => {
		const { url, calls } = await serve({ extra: slots });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({
			name: 'afd-batch',
			arguments: {
				commands: [
					{ command: 'slot-take', input: { id: 2 } },
					{ command: 'slot-claim', input: {} },
				],
			},
		});
		// The human approved slot 2, the next free one when asked. When the step runs, the input
		// as sent defaults to slot 3, which is free, but slot 2, the one that would run, is taken.
		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toContain('"id":2');
		expect(codes(result)).toEqual([undefined, 'VALIDATION_ERROR']);
		expect(calls).toEqual(['take:2']);
	});

	it('fails an approved step whose schema does not read its approved input back unchanged (#1511)', async () => {
		const scaled = (calls: string[]) =>
			[
				defineCommand({
					name: 'price-set',
					description: 'Set a price in cents',
					mutation: true,
					approval: 'required',
					expose: { mcp: true },
					input: z.object({ cents: z.number().transform((n) => n * 100) }),
					handler: async (input) => {
						calls.push(`price:${input.cents}`);
						return success({ cents: input.cents });
					},
				}),
			] as unknown as ReturnType<typeof commands>;
		const { url, calls } = await serve({ extra: scaled });
		const prompts: string[] = [];
		const client = await connect(url, 'accept', prompts);
		const result = await client.callTool({
			name: 'afd-batch',
			arguments: { commands: [{ command: 'price-set', input: { cents: 5 } }] },
		});
		// 500 was approved; read back, it would be 50,000. Nothing runs.
		expect(codes(result)).toEqual(['VALIDATION_ERROR']);
		expect(calls).toEqual([]);
	});
});
