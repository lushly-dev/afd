/**
 * @fileoverview The server's wiring (`createTodoServices`), as `chat-server.ts` builds it: `/mcp`
 * accepts the hosts the server accepts, and both ways in write one journal.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setStore, TodoStore } from '@afd/example-todo-ts/store';
import { createDirectClient } from '@lushly-dev/afd-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ChatServer, createChatServer } from './chat-http.js';
import { loadChatServerConfig } from './http-security.js';
import { createTodoServices } from './services.js';

const quietChat = {
	processChat: async () => ({}),
	isConfigured: () => false,
	getMetrics: () => ({}),
};

let running: { server: ChatServer; dispose: () => void } | undefined;
let dir: string;

beforeEach(() => {
	setStore(new TodoStore());
	dir = mkdtempSync(join(tmpdir(), 'todo-services-'));
});

afterEach(async () => {
	if (running) {
		running.dispose();
		running.server.server.closeAllConnections();
		await new Promise<void>((done) => running?.server.server.close(() => done()));
		running = undefined;
	}
	rmSync(dir, { recursive: true, force: true });
});

/** Start the server with the wiring chat-server.ts uses. */
async function start(env: Record<string, string>) {
	const config = loadChatServerConfig(env);
	const services = createTodoServices(env, config);
	const server = createChatServer(config, {
		executor: createDirectClient(services.registry),
		chat: quietChat,
		mcp: services.mcp,
		onError: () => {},
	});
	running = { server, dispose: () => services.mcp.dispose() };
	await new Promise<void>((ready) => server.server.listen(0, config.host, ready));
	const { port } = server.server.address() as AddressInfo;
	return { services, base: `http://127.0.0.1:${port}` };
}

/**
 * One request through node:http, which sends the Host header it is given (fetch does not: Host is
 * a forbidden header there).
 */
function send(
	url: string,
	method: string,
	headers: Record<string, string>,
	body?: string
): Promise<{ status: number; headers: Record<string, unknown> }> {
	return new Promise((done, fail) => {
		const req = request(url, { method, headers }, (res) => {
			res.resume();
			res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers }));
		});
		req.on('error', fail);
		req.end(body);
	});
}

/** Initialize an MCP session and run one tool, with these extra headers. */
async function mcpCall(base: string, headers: Record<string, string>, name: string) {
	const post = (body: unknown, session?: string) =>
		send(
			`${base}/mcp`,
			'POST',
			{
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				...(session && { 'Mcp-Session-Id': session }),
				...headers,
			},
			JSON.stringify(body)
		);
	const init = await post({
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'test', version: '1.0.0' },
		},
	});
	if (init.status !== 200) return init.status;
	const session = init.headers['mcp-session-id'];
	const call = await post(
		{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: {} } },
		typeof session === 'string' ? session : undefined
	);
	return call.status;
}

describe('createTodoServices', () => {
	it('lets /mcp accept the hosts in ALLOWED_HOSTS, as the rest of the server does', async () => {
		const { base } = await start({ ALLOWED_HOSTS: 'todo.test' });
		const headers = { Host: 'todo.test' };
		expect((await send(`${base}/health`, 'GET', headers)).status).toBe(200);
		expect(await mcpCall(base, headers, 'todo-list')).toBe(200);
	});

	it('writes one journal for the copilot and /mcp, numbered once', async () => {
		const journal = join(dir, 'journal.jsonl');
		const { base, services } = await start({ TODO_JOURNAL: journal, APPROVALS: 'off' });
		const direct = createDirectClient(services.registry, { actor: { kind: 'agent' } });
		await direct.call('todo-create', { title: 'From the copilot' });
		expect(await mcpCall(base, {}, 'todo-stats')).toBe(200);
		await direct.call('todo-list', {});

		const seqs = readFileSync(journal, 'utf8')
			.trim()
			.split('\n')
			.map((line) => (JSON.parse(line) as { seq: number }).seq);
		expect(seqs).toEqual([1, 2, 3]);
	});
});
