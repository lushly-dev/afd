/**
 * @fileoverview The documented dev frontends can call the server from the
 * browser; other origins cannot.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMcpHandler } from '@lushly-dev/afd-server';
import { afterEach, describe, expect, it } from 'vitest';
import {
	createTodoServerOptions,
	devFrontendOrigins,
	type Env,
	resolveAllowedOrigins,
} from './server-options.js';

let server: Server | undefined;

afterEach(async () => {
	const running = server;
	server = undefined;
	if (!running) return;
	running.closeAllConnections();
	await new Promise<void>((resolve) => running.close(() => resolve()));
});

async function start(env: Env = {}): Promise<string> {
	server = createServer(createMcpHandler(createTodoServerOptions({ ...env, LOG_LEVEL: 'warn' })));
	await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The request both frontends send (`frontends/*: callTool`). */
function callTool(base: string, origin: string, name = 'todo-stats') {
	return fetch(`${base}/message`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: origin },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name, arguments: {} },
		}),
	});
}

describe('resolveAllowedOrigins', () => {
	it('includes the README dev frontends on both loopback names', () => {
		const origins = resolveAllowedOrigins({});
		for (const origin of [
			'http://localhost:3000',
			'http://127.0.0.1:3000',
			'http://localhost:5173',
			'http://127.0.0.1:5173',
		]) {
			expect(origins).toContain(origin);
		}
	});

	it('adds exact origins from ALLOWED_ORIGINS', () => {
		expect(resolveAllowedOrigins({ ALLOWED_ORIGINS: 'https://todo.example.com' })).toEqual([
			...devFrontendOrigins(),
			'https://todo.example.com',
		]);
	});

	it.each(['*', 'null', 'localhost:8080', 'http://localhost:8080/'])(
		'refuses ALLOWED_ORIGINS=%s',
		(origin) => {
			expect(() => resolveAllowedOrigins({ ALLOWED_ORIGINS: origin })).toThrow(/ALLOWED_ORIGINS/);
		}
	);
});

describe('browser access (production mode)', () => {
	it.each(['http://localhost:3000', 'http://localhost:5173'])(
		'lets the dev frontend at %s call tools',
		async (origin) => {
			const base = await start();
			const res = await callTool(base, origin);
			const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };

			expect(res.status).toBe(200);
			expect(res.headers.get('access-control-allow-origin')).toBe(origin);
			expect(JSON.parse(body.result?.content[0]?.text ?? '{}').success).toBe(true);
		}
	);

	it('answers the CORS preflight for a dev frontend', async () => {
		const base = await start();
		const res = await fetch(`${base}/message`, {
			method: 'OPTIONS',
			headers: {
				Origin: 'http://localhost:5173',
				'Access-Control-Request-Method': 'POST',
				'Access-Control-Request-Headers': 'content-type',
			},
		});

		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
	});

	it('refuses other origins', async () => {
		const base = await start();
		const res = await callTool(base, 'https://evil.example');

		expect(res.status).toBe(403);
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
	});

	it('accepts an origin added with ALLOWED_ORIGINS', async () => {
		const base = await start({ ALLOWED_ORIGINS: 'http://localhost:8080' });
		expect((await callTool(base, 'http://localhost:8080')).status).toBe(200);
	});
});

describe('contexts (src/contexts.ts)', () => {
	const MODERN = '2026-07-28';
	const META = {
		'io.modelcontextprotocol/protocolVersion': MODERN,
		'io.modelcontextprotocol/clientCapabilities': {},
		'io.modelcontextprotocol/clientInfo': { name: 'todo-test', version: '0' },
	};

	/** One stateless MCP 2026-07-28 request on /mcp, scoped by `context` when given. */
	async function mcp(
		base: string,
		method: string,
		params: Record<string, unknown>,
		context?: string
	) {
		const res = await fetch(`${base}/mcp`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				'MCP-Protocol-Version': MODERN,
				'Mcp-Method': method,
				...(typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {}),
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method,
				params: {
					...params,
					_meta: { ...META, ...(context ? { 'dev.afd/context': context } : {}) },
				},
			}),
		});
		const text = await res.text();
		const data = /^data: (.*)$/m.exec(text)?.[1];
		return JSON.parse(data ?? text) as { result?: Record<string, unknown> };
	}

	it('registers the context tools and hides the writes while reading', async () => {
		const base = await start();
		// The default grouped strategy: one tool per category, its commands as `action` values.
		const actions = async (tool: string, context?: string) => {
			const { result } = await mcp(base, 'tools/list', {}, context);
			const tools = (result?.tools ?? []) as Array<{
				name: string;
				inputSchema: { properties: { action: { enum: string[] } } };
			}>;
			return tools.find((entry) => entry.name === tool)?.inputSchema.properties.action.enum ?? [];
		};

		expect(await actions('bootstrap')).toEqual(
			expect.arrayContaining(['context-list', 'context-enter', 'context-exit'])
		);
		expect(await actions('todo')).toContain('create');
		expect((await actions('todo', 'todo-reading')).sort()).toEqual(['get', 'list', 'stats']);
	});

	it('refuses a change while reading', async () => {
		const base = await start();
		const { result } = await mcp(
			base,
			'tools/call',
			{ name: 'todo-create', arguments: { title: 'Not now' } },
			'todo-reading'
		);
		const content = result?.content as Array<{ text: string }>;
		expect(JSON.parse(content[0]?.text ?? '{}')).toMatchObject({
			success: false,
			error: { code: 'COMMAND_NOT_IN_CONTEXT', suggestion: expect.any(String) },
		});
	});
});
