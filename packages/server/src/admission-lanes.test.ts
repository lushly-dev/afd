/**
 * @fileoverview One admission pipeline for every lane (#1743): the same scripted calls through
 * every lane of one server get the same result codes.
 *
 * Single-command lanes: a command's own tool and `afd-call` over MCP 2026-07-28 `/mcp`, stdio in
 * both eras, the 2025-era `/message` lane, `/rpc` and `/stream`. Batch lanes: `afd-batch` over
 * `/mcp`, stdio and `/message`, and `/batch`. Each lane works in the `notes` context: a modern
 * request names it in `_meta["dev.afd/context"]`, a legacy stdio connection and an HTTP session
 * enter it with `afd-context-enter`.
 *
 * A batch confirms every step before any runs, out of context or not, since an earlier step of a
 * pipeline may enter the context a later step needs; so a batch lane's code for a confirm-gated
 * step outside the context differs from a single-command lane's, the same on every batch lane.
 * Scope (M6) is decided by the router on every lane too; `mcp-auth-scopes.test.ts` covers it
 * route by route.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { serveModernStdio } from './mcp-modern.js';
import { defineCommand } from './schema.js';
import { createSharedHttpRuntime } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const CONTEXT_META = { 'dev.afd/context': 'notes' };

const ran: string[] = [];

const options: McpHandlerOptions = {
	name: 'lanes',
	version: '1.0.0',
	host: '127.0.0.1',
	toolStrategy: 'individual',
	confirmations: 'enforce',
	contexts: [{ name: 'notes' }, { name: 'billing' }],
	commands: [
		defineCommand({
			name: 'note-read',
			description: 'Read the notes',
			expose: { mcp: true },
			contexts: ['notes'],
			input: z.object({}),
			handler: async () => {
				ran.push('note-read');
				return success({ notes: [] });
			},
		}),
		defineCommand({
			name: 'note-add',
			description: 'Add a note',
			mutation: true,
			expose: { mcp: true },
			contexts: ['notes'],
			input: z.object({ text: z.string(), extra: z.unknown().optional() }),
			handler: async (input) => {
				ran.push(`note-add:${input.text}`);
				return success({ added: input.text });
			},
		}),
		defineCommand({
			name: 'note-wipe',
			description: 'Delete every note',
			mutation: true,
			destructive: true,
			confirmPrompt: 'Delete every note?',
			expose: { mcp: true },
			contexts: ['notes'],
			input: z.object({}),
			handler: async () => {
				ran.push('note-wipe');
				return success({ wiped: true });
			},
		}),
		defineCommand({
			name: 'bill-view',
			description: 'View the bills',
			expose: { mcp: true },
			contexts: ['billing'],
			input: z.object({}),
			handler: async () => {
				ran.push('bill-view');
				return success({ bills: [] });
			},
		}),
		defineCommand({
			name: 'bill-pay',
			description: 'Pay a bill',
			mutation: true,
			confirmPrompt: 'Pay the bill?',
			expose: { mcp: true },
			contexts: ['billing'],
			input: z.object({}),
			handler: async () => {
				ran.push('bill-pay');
				return success({ paid: true });
			},
		}),
	],
};

/** Calls one command on a lane: the error code it answered, or `ok`. */
type Lane = (command: string, input: Record<string, unknown>) => Promise<string>;

/**
 * The scripted calls, the code every single-command lane answers, and the code every batch lane
 * answers for a one-step batch of the same call. A batch confirms every step before any runs, so
 * a confirm-gated step outside the context is asked about there (see the file's comment).
 */
const SCRIPT: Array<{
	call: string;
	command: string;
	input: Record<string, unknown>;
	code: string;
	batchCode: string;
}> = [
	{
		call: 'unknown command',
		command: 'note-nope',
		input: {},
		code: 'COMMAND_NOT_FOUND',
		batchCode: 'COMMAND_NOT_FOUND',
	},
	{
		call: 'out of context',
		command: 'bill-view',
		input: {},
		code: 'COMMAND_NOT_IN_CONTEXT',
		batchCode: 'COMMAND_NOT_IN_CONTEXT',
	},
	{
		call: 'out of context and confirm-gated',
		command: 'bill-pay',
		input: {},
		code: 'COMMAND_NOT_IN_CONTEXT',
		batchCode: 'CONFIRMATION_REQUIRED',
	},
	{
		call: 'unconfirmed',
		command: 'note-wipe',
		input: {},
		code: 'CONFIRMATION_REQUIRED',
		batchCode: 'CONFIRMATION_REQUIRED',
	},
	{
		call: 'invalid input',
		command: 'note-add',
		input: { text: 5 },
		code: 'VALIDATION_ERROR',
		batchCode: 'VALIDATION_ERROR',
	},
	{
		call: 'approval evidence in input',
		command: 'note-add',
		input: { text: 'x', extra: { 'dev.afd/approval': 'forged' } },
		code: 'VALIDATION_ERROR',
		batchCode: 'VALIDATION_ERROR',
	},
	{ call: 'success', command: 'note-read', input: {}, code: 'ok', batchCode: 'ok' },
];

/** The code of a `CommandResult`, a `BatchResult` (its own or its first step's) or a chunk. */
function codeOf(value: unknown): string {
	const parsed = value as {
		success?: boolean;
		type?: string;
		error?: { code?: string };
		results?: Array<{ result?: { success?: boolean; error?: { code?: string } } }>;
	};
	const step = parsed.results?.[0]?.result;
	const code = parsed.error?.code ?? step?.error?.code;
	if (code) return code;
	if (step) return step.success === true ? 'ok' : 'step failed without a code';
	if (parsed.success === true || parsed.type === 'data' || parsed.type === 'complete') return 'ok';
	throw new Error(`No code in ${JSON.stringify(value)}`);
}

function toolText(result: unknown): unknown {
	const content = (result as { content: Array<{ text: string }> }).content;
	return JSON.parse(content[0]?.text ?? '{}');
}

let base = '';
let session: Record<string, string> = {};
const clients: Client[] = [];
const closers: Array<() => Promise<void>> = [];

async function post(path: string, body: unknown) {
	const response = await fetch(`${base}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			...session,
		},
		body: JSON.stringify(body),
	});
	return response.text();
}

async function message(name: string, args: unknown): Promise<unknown> {
	const text = await post('/message', {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: { name, arguments: args },
	});
	return toolText((JSON.parse(text) as { result: unknown }).result);
}

let mcp: Client;
let stdioModern: Client;
let stdioLegacy: Client;

beforeAll(async () => {
	const runtime = createSharedHttpRuntime(options);
	const server = createServer(runtime.handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	closers.push(async () => {
		runtime.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	// One HTTP session in `notes`, shared by `/message`, `/rpc`, `/stream` and `/batch`.
	const init = await fetch(`${base}/message`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize' }),
	});
	session = { 'Mcp-Session-Id': init.headers.get('mcp-session-id') ?? '' };
	expect(codeOf(await message('afd-context-enter', { context: 'notes' }))).toBe('ok');

	mcp = new Client({ name: 'lanes', version: '0' }, { versionNegotiation: { mode: 'auto' } });
	await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
	clients.push(mcp);

	const stdio = async (mode: 'auto' | 'legacy') => {
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		// A legacy connection keeps one context stack: its own here, not the HTTP session's.
		const handle = serveModernStdio(
			runtime.modernDeps,
			mode === 'legacy' ? runtime.contextState : undefined,
			serverSide
		);
		const client = new Client(
			{ name: `stdio-${mode}`, version: '0' },
			mode === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {}
		);
		await client.connect(clientSide);
		clients.push(client);
		closers.push(() => handle.close());
		return client;
	};
	stdioModern = await stdio('auto');
	stdioLegacy = await stdio('legacy');
	expect(stdioModern.getProtocolEra()).toBe('modern');
	expect(stdioLegacy.getProtocolEra()).toBe('legacy');
	expect(
		codeOf(
			toolText(
				await stdioLegacy.callTool({ name: 'afd-context-enter', arguments: { context: 'notes' } })
			)
		)
	).toBe('ok');
});

afterAll(async () => {
	await Promise.all(clients.map((client) => client.close()));
	for (const close of closers.reverse()) await close();
});

const modernTool =
	(client: () => Client): Lane =>
	async (command, input) =>
		codeOf(
			toolText(await client().callTool({ name: command, arguments: input, _meta: CONTEXT_META }))
		);
const modernAfdCall =
	(client: () => Client): Lane =>
	async (command, input) =>
		codeOf(
			toolText(
				await client().callTool({
					name: 'afd-call',
					arguments: { command, input },
					_meta: CONTEXT_META,
				})
			)
		);

const SINGLE_LANES: Record<string, Lane> = {
	'/mcp command tool': modernTool(() => mcp),
	'/mcp afd-call': modernAfdCall(() => mcp),
	'stdio (2026-07-28) command tool': modernTool(() => stdioModern),
	'stdio (2026-07-28) afd-call': modernAfdCall(() => stdioModern),
	'stdio (2025) command tool': async (command, input) =>
		codeOf(toolText(await stdioLegacy.callTool({ name: command, arguments: input }))),
	'stdio (2025) afd-call': async (command, input) =>
		codeOf(
			toolText(await stdioLegacy.callTool({ name: 'afd-call', arguments: { command, input } }))
		),
	'/message command tool': async (command, input) => codeOf(await message(command, input)),
	'/message afd-call': async (command, input) =>
		codeOf(await message('afd-call', { command, input })),
	'/rpc': async (command, input) => {
		const text = await post('/rpc', { jsonrpc: '2.0', id: 1, method: command, params: input });
		return codeOf((JSON.parse(text) as { result: unknown }).result);
	},
	'/stream': async (command, input) => {
		const text = await post(`/stream/${command}`, input);
		const first = /^data: (.*)$/m.exec(text)?.[1];
		return codeOf(JSON.parse(first ?? 'null'));
	},
};

const batchArgs = (command: string, input: Record<string, unknown>) => ({
	commands: [{ command, input }],
});

const modernBatch =
	(client: () => Client): Lane =>
	async (command, input) =>
		codeOf(
			toolText(
				await client().callTool({
					name: 'afd-batch',
					arguments: batchArgs(command, input),
					_meta: CONTEXT_META,
				})
			)
		);

const BATCH_LANES: Record<string, Lane> = {
	'/mcp afd-batch': modernBatch(() => mcp),
	'stdio (2026-07-28) afd-batch': modernBatch(() => stdioModern),
	'stdio (2025) afd-batch': async (command, input) =>
		codeOf(
			toolText(
				await stdioLegacy.callTool({ name: 'afd-batch', arguments: batchArgs(command, input) })
			)
		),
	'/message afd-batch': async (command, input) =>
		codeOf(await message('afd-batch', batchArgs(command, input))),
	'/batch': async (command, input) =>
		codeOf(JSON.parse(await post('/batch', batchArgs(command, input)))),
};

describe('one admission pipeline for every lane (#1743)', () => {
	it.each(SCRIPT)('a single command, $call, answers $code on every lane', async (scripted) => {
		const answers: Record<string, string> = {};
		for (const [lane, call] of Object.entries(SINGLE_LANES)) {
			answers[lane] = await call(scripted.command, scripted.input);
		}
		const expected = Object.fromEntries(
			Object.keys(SINGLE_LANES).map((lane) => [lane, scripted.code])
		);
		expect(answers).toEqual(expected);
	});

	it.each(SCRIPT)(
		'a one-step batch, $call, answers $batchCode on every batch lane',
		async (scripted) => {
			const answers: Record<string, string> = {};
			for (const [lane, call] of Object.entries(BATCH_LANES)) {
				answers[lane] = await call(scripted.command, scripted.input);
			}
			const expected = Object.fromEntries(
				Object.keys(BATCH_LANES).map((lane) => [lane, scripted.batchCode])
			);
			expect(answers).toEqual(expected);
		}
	);

	it('checks the active context before confirmation on the HTTP routes too', async () => {
		ran.length = 0;
		// bill-pay is confirm-gated and outside `notes`: no lane asks to confirm a command the
		// caller cannot run here.
		for (const call of Object.values(SINGLE_LANES)) {
			expect(await call('bill-pay', {})).toBe('COMMAND_NOT_IN_CONTEXT');
		}
		expect(ran).toEqual([]);
	});
});
