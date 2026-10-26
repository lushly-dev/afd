/**
 * The MCP approval relay (#418): `createApprovalMiddleware({ relay: 'mcp-elicitation' })` asks the
 * human behind the MCP client through a form elicitation, and an agent cannot approve its own call.
 */
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
	type ApprovalRelay,
	approvalRelay,
	bindApprovalRelay,
	withoutApprovalRelay,
} from './approval-relay.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

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
	const list = commands(calls);
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
		| { code: string; suggestion: string; retryable?: boolean; details?: Record<string, unknown> }
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

		it('for afd-batch and afd-pipe steps, without running earlier steps twice', async () => {
			const { url, calls } = await serve();
			const prompts: string[] = [];
			const client = await connect(url, 'accept', prompts);
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
			expect(results[1]?.result.error?.suggestion).toContain('Call todo-delete on its own');

			// A gated first step would claim the relay if steps could: it must not.
			const gatedFirst = await client.callTool({
				name: 'afd-batch',
				arguments: {
					commands: [
						{ command: 'todo-delete', input: { id: 2 } },
						{ command: 'todo-list', input: {} },
					],
				},
			});
			const gatedResults = body(gatedFirst).results as Array<{ result: CommandResult }>;
			expect(gatedResults[0]?.result.error?.code).toBe('APPROVAL_REQUIRED');

			const pipe = await client.callTool({
				name: 'afd-pipe',
				arguments: {
					steps: [{ command: 'todo-list' }, { command: 'todo-delete', input: { id: 1 } }],
				},
			});
			const steps = body(pipe).steps as Array<{ error?: { code: string } }>;
			expect(steps[1]?.error?.code).toBe('APPROVAL_REQUIRED');
			const gatedPipe = await client.callTool({
				name: 'afd-pipe',
				arguments: { steps: [{ command: 'todo-delete', input: { id: 2 } }] },
			});
			expect((body(gatedPipe).steps as Array<{ error?: { code: string } }>)[0]?.error?.code).toBe(
				'APPROVAL_REQUIRED'
			);
			expect(prompts).toEqual([]);
			expect(calls).toEqual(['list', 'list', 'list']);
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
				_meta: { 'dev.afd/approval': token },
			};
			const loose = await client.callTool({ name: 'todo-delete', arguments: smuggled });
			expect(error(loose)?.code).toBe('APPROVAL_REQUIRED');
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
				{ inputResponses: approved, requestState: `${state.slice(0, -2)}xx` }
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
