/**
 * Context scoping over HTTP is per MCP session: one client entering a context must not change
 * another client's tool list or execution (quality review H3).
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpClient } from '@lushly-dev/afd-client';
import { success } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const commands = ['edit', 'print'].map((context) =>
	defineCommand({
		name: `${context}-run`,
		description: `Run ${context}`,
		expose: { mcp: true },
		contexts: [context],
		input: z.object({}),
		handler: async () => success({ ran: context }),
	})
);

async function host(options: Partial<McpHandlerOptions> = {}) {
	const handler = createMcpHandler({
		name: 'sessions',
		version: '1',
		host: '127.0.0.1',
		commands,
		contexts: [{ name: 'edit' }, { name: 'print' }],
		toolStrategy: 'individual',
		...options,
	});
	const server = createServer(handler);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	});
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function post(url: string, path: string, body: unknown, headers: Record<string, string> = {}) {
	return fetch(`${url}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});
}

/**
 * A raw HTTP MCP client that repeats the session issued by initialize (if any). A stateless
 * client skips initialize and never sends `Mcp-Session-Id`.
 */
async function session(url: string, stateful = true) {
	const init = stateful
		? await post(url, '/message', { jsonrpc: '2.0', id: 0, method: 'initialize' })
		: undefined;
	const id = init?.headers.get('mcp-session-id') ?? null;
	const headers: Record<string, string> = id ? { 'Mcp-Session-Id': id } : {};
	return {
		id,
		headers,
		async call(name: string, args: unknown = {}) {
			const response = await post(
				url,
				'/message',
				{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
				headers
			);
			const body = (await response.json()) as { result: { content: [{ text: string }] } };
			return JSON.parse(body.result.content[0].text);
		},
		async tools(): Promise<string[]> {
			const response = await post(
				url,
				'/message',
				{ jsonrpc: '2.0', id: 2, method: 'tools/list' },
				headers
			);
			const body = (await response.json()) as { result: { tools: Array<{ name: string }> } };
			return body.result.tools.map((tool) => tool.name);
		},
	};
}

describe('per-session context state over HTTP', () => {
	it('isolates two sessions on every execution path', async () => {
		const url = await host();
		const a = await session(url);
		const b = await session(url);
		expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(a.id).not.toBe(b.id);

		expect((await a.call('afd-context-enter', { context: 'edit' })).success).toBe(true);
		expect(await a.tools()).not.toContain('print-run');
		expect(await b.tools()).toEqual(expect.arrayContaining(['edit-run', 'print-run']));
		expect((await a.call('afd-context-list')).data.activeContext).toBe('edit');
		expect((await b.call('afd-context-list')).data.activeContext).toBeNull();

		expect((await a.call('print-run')).error.code).toBe('COMMAND_NOT_IN_CONTEXT');
		expect((await b.call('print-run')).success).toBe(true);

		const rpc = async (headers: Record<string, string>) =>
			(
				(await (await post(url, '/rpc', { id: 1, method: 'print-run' }, headers)).json()) as {
					result: { success: boolean };
				}
			).result.success;
		expect(await rpc(a.headers)).toBe(false);
		expect(await rpc(b.headers)).toBe(true);

		const batch = async (headers: Record<string, string>) =>
			(
				(await (
					await post(url, '/batch', { commands: [{ command: 'print-run', input: {} }] }, headers)
				).json()) as { results: [{ result: { success: boolean } }] }
			).results[0].result.success;
		expect(await batch(a.headers)).toBe(false);
		expect(await batch(b.headers)).toBe(true);

		const stream = async (headers: Record<string, string>) =>
			(await post(url, '/stream/print-run', {}, headers)).text();
		expect(await stream(a.headers)).toContain('COMMAND_NOT_IN_CONTEXT');
		expect(await stream(b.headers)).toContain('"ran":"print"');

		expect(
			(await a.call('afd-pipe', { steps: [{ command: 'print-run' }] })).steps[0].error.code
		).toBe('COMMAND_NOT_IN_CONTEXT');
		expect((await b.call('afd-pipe', { steps: [{ command: 'print-run' }] })).steps[0].status).toBe(
			'success'
		);
	});

	it('makes re-entering the active context a no-op', async () => {
		const a = await session(await host());
		await a.call('afd-context-enter', { context: 'edit' });
		expect((await a.call('afd-context-enter', { context: 'edit' })).data).toEqual({
			entered: 'edit',
			previous: 'edit',
		});
		expect((await a.call('afd-context-exit')).data).toEqual({ exited: 'edit', current: null });
	});

	it('treats requests without a session as stateless', async () => {
		const url = await host();
		const stateless = await session(url, false);
		const other = await session(url);
		await other.call('afd-context-enter', { context: 'edit' });

		const entered = await stateless.call('afd-context-enter', { context: 'print' });
		expect(entered.error.code).toBe('SESSION_REQUIRED');
		expect(entered.error.suggestion).toContain('Mcp-Session-Id');
		expect((await stateless.call('afd-context-exit')).error.code).toBe('SESSION_REQUIRED');
		expect((await stateless.call('afd-context-list')).data.activeContext).toBeNull();
		expect(await stateless.tools()).toEqual(expect.arrayContaining(['edit-run', 'print-run']));
		expect((await stateless.call('print-run')).success).toBe(true);
	});

	it('rejects unknown or expired sessions with 404', async () => {
		const url = await host({ sessionIdleTimeoutMs: 1 });
		const headers = { 'Mcp-Session-Id': 'not-a-session' };
		const message = await post(
			url,
			'/message',
			{ jsonrpc: '2.0', id: 1, method: 'tools/list' },
			headers
		);
		expect(message.status).toBe(404);
		expect(await message.json()).toMatchObject({ id: null, error: { code: -32001 } });
		const notification = await post(url, '/message', { jsonrpc: '2.0', method: 'ping' }, headers);
		expect(notification.status).toBe(404);
		const batch = await post(
			url,
			'/batch',
			{ commands: [{ command: 'edit-run', input: {} }] },
			headers
		);
		expect(batch.status).toBe(404);
		expect(await batch.json()).toMatchObject({
			success: false,
			error: { code: 'HTTP_404', suggestion: expect.stringContaining('initialize') },
		});
		expect((await fetch(`${url}/stream/edit-run`, { headers })).status).toBe(404);

		const expiring = await session(url);
		await new Promise((resolve) => setTimeout(resolve, 5));
		const expired = await post(
			url,
			'/message',
			{ jsonrpc: '2.0', id: 1, method: 'ping' },
			expiring.headers
		);
		expect(expired.status).toBe(404);
	});

	it('ignores session headers when no contexts are configured', async () => {
		const url = await host({ contexts: undefined });
		const plain = await session(url);
		expect(plain.id).toBeNull();
		const response = await post(
			url,
			'/message',
			{ jsonrpc: '2.0', id: 1, method: 'tools/list' },
			{ 'Mcp-Session-Id': 'anything' }
		);
		expect(response.status).toBe(200);
	});

	it('isolates two real McpClient connections', async () => {
		const url = await host();
		const clients = [0, 1].map(
			() => new McpClient({ url: `${url}/message`, transport: 'http', autoReconnect: false })
		);
		cleanups.push(async () => {
			for (const client of clients) await client.disconnect();
		});
		const [a, b] = clients as [McpClient, McpClient];
		await a.connect();
		await b.connect();

		expect((await a.call('afd-context-enter', { context: 'print' })).success).toBe(true);
		expect((await a.listTools()).map((tool) => tool.name)).not.toContain('edit-run');
		expect((await b.listTools()).map((tool) => tool.name)).toContain('edit-run');
		expect((await a.call('edit-run', {})).error?.code).toBe('COMMAND_NOT_IN_CONTEXT');
		expect((await b.call('edit-run', {})).success).toBe(true);
	});
});
