import type { AddressInfo } from 'node:net';
import { DirectClient } from '@lushly-dev/afd-client';
import { createDirectRegistry, defineCommand, success } from '@lushly-dev/afd-server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type ChatBackend, type ChatServer, createChatServer, PublicError } from './chat-http.js';
import { type Env, loadChatServerConfig } from './http-security.js';
import { registry } from './registry.js';
import { store } from './store/index.js';

interface Reply {
	status: number;
	headers: Headers;
	body: Record<string, unknown>;
	text: string;
}

const fakeChat: ChatBackend = {
	processChat: async (message) => ({ message: `echo: ${message}`, toolExecutions: [] }),
	isConfigured: () => true,
	getMetrics: () => ({ requestCount: 0 }),
};

let running: ChatServer | undefined;

async function start(env: Env = {}, deps: Partial<Parameters<typeof createChatServer>[1]> = {}) {
	const config = loadChatServerConfig(env);
	running = createChatServer(config, {
		executor: new DirectClient(registry),
		chat: fakeChat,
		onError: () => {},
		...deps,
	});
	const { server } = running;
	// Port 0 picks a free port; the host is the configured default bind address.
	await new Promise<void>((resolve) => server.listen(0, config.host, resolve));
	const address = server.address() as AddressInfo;
	return { address, base: `http://127.0.0.1:${address.port}`, config };
}

async function request(url: string, init: RequestInit = {}): Promise<Reply> {
	const response = await fetch(url, init);
	const text = await response.text();
	let body: Record<string, unknown> = {};
	try {
		body = JSON.parse(text) as Record<string, unknown>;
	} catch {}
	return { status: response.status, headers: response.headers, body, text };
}

function post(url: string, payload: unknown, headers: Record<string, string> = {}) {
	return request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(payload),
	});
}

async function stop(): Promise<void> {
	const server = running?.server;
	running = undefined;
	if (!server) return;
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
	await stop();
	store.clear();
});

describe('chat server binding', () => {
	it('listens on 127.0.0.1 by default', async () => {
		const { address } = await start();
		expect(address.address).toBe('127.0.0.1');
	});
});

describe('chat server origin policy', () => {
	it('accepts the frontend origins by default and echoes them in CORS headers', async () => {
		const { base } = await start();
		const res = await request(`${base}/health`, { headers: { Origin: 'http://localhost:3201' } });

		expect(res.status).toBe(200);
		expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3201');
	});

	it('adds the origins listed in ALLOWED_ORIGINS', async () => {
		const { base } = await start({ ALLOWED_ORIGINS: 'http://localhost:5173' });
		const listed = await request(`${base}/health`, {
			headers: { Origin: 'http://localhost:5173' },
		});
		const unlisted = await request(`${base}/health`, {
			headers: { Origin: 'http://localhost:5174' },
		});

		expect(listed.status).toBe(200);
		expect(unlisted.status).toBe(403);
	});

	it('rejects a foreign origin without reflecting it', async () => {
		const { base } = await start();
		const res = await post(
			`${base}/execute`,
			{ name: 'todo-create', args: { title: 'csrf' } },
			{ Origin: 'https://evil.example' }
		);

		expect(res.status).toBe(403);
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
		expect(store.count()).toBe(0);
	});

	it('rejects the null origin', async () => {
		const { base } = await start();
		const res = await post(`${base}/execute`, { name: 'todo-list' }, { Origin: 'null' });
		expect(res.status).toBe(403);
	});

	it('rejects a Host header that does not name this server (DNS rebinding)', async () => {
		const { base } = await start();
		const { request: httpRequest } = await import('node:http');
		const status = await new Promise<number>((resolve, reject) => {
			const req = httpRequest(
				`${base}/metrics`,
				{ headers: { Host: 'rebind.evil.example:3201' } },
				(res) => {
					res.resume();
					resolve(res.statusCode ?? 0);
				}
			);
			req.on('error', reject);
			req.end();
		});
		expect(status).toBe(403);
	});
});

describe('chat server rate limiting', () => {
	it('keys on the socket address, so rotating X-Forwarded-For does not help', async () => {
		const { base } = await start({ RATE_LIMIT_EXECUTE: '2' });
		const statuses: number[] = [];
		for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
			const res = await post(`${base}/execute`, { name: 'todo-list' }, { 'X-Forwarded-For': ip });
			statuses.push(res.status);
		}

		expect(statuses).toEqual([200, 200, 429]);
	});

	it('reports Retry-After when limited', async () => {
		const { base } = await start({ RATE_LIMIT_CHAT: '1' });
		await post(`${base}/chat`, { message: 'hi' });
		const res = await post(`${base}/chat`, { message: 'again' });

		expect(res.status).toBe(429);
		expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
	});

	it('honors the proxy-appended X-Forwarded-For entry with TRUST_PROXY', async () => {
		const { base } = await start({ RATE_LIMIT_EXECUTE: '1', TRUST_PROXY: 'true' });
		const first = await post(
			`${base}/execute`,
			{ name: 'todo-list' },
			{ 'X-Forwarded-For': 'a, 1.1.1.1' }
		);
		const second = await post(
			`${base}/execute`,
			{ name: 'todo-list' },
			{ 'X-Forwarded-For': 'b, 2.2.2.2' }
		);
		// Same client behind the proxy, spoofed first entry: still limited.
		const spoofed = await post(
			`${base}/execute`,
			{ name: 'todo-list' },
			{ 'X-Forwarded-For': 'c, 2.2.2.2' }
		);

		expect([first.status, second.status, spoofed.status]).toEqual([200, 200, 429]);
	});
});

describe('POST /execute', () => {
	it('runs commands through the validating registry', async () => {
		const { base } = await start();
		const res = await post(`${base}/execute`, {
			name: 'todo-create',
			args: { title: 'From the UI', priority: 'high' },
		});

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(store.count()).toBe(1);
	});

	it('rejects input that fails the Zod schema before the handler runs', async () => {
		const { base } = await start();
		const res = await post(`${base}/execute`, {
			name: 'todo-create',
			args: { title: { nested: true } },
		});

		expect(res.body.success).toBe(false);
		expect((res.body.error as { code: string }).code).toBe('VALIDATION_ERROR');
		expect(store.count()).toBe(0);
	});

	it('cannot run a command that is not exposed to the agent', async () => {
		let ran = false;
		const internal = defineCommand({
			name: 'admin-reset',
			description: 'Internal only',
			expose: { agent: false },
			input: z.object({}),
			async handler() {
				ran = true;
				return success({ reset: true });
			},
		});
		const { base } = await start(
			{},
			{ executor: new DirectClient(createDirectRegistry([internal], { interface: 'agent' })) }
		);
		const res = await post(`${base}/execute`, { name: 'admin-reset' });

		expect(res.body.success).toBe(false);
		expect(ran).toBe(false);
	});

	it('rejects malformed requests', async () => {
		const { base } = await start();

		expect((await post(`${base}/execute`, { name: '../etc' })).status).toBe(400);
		expect((await post(`${base}/execute`, { name: 'todo-list', args: [1] })).status).toBe(400);
		expect((await post(`${base}/execute`, ['todo-list'])).status).toBe(400);
		const notJson = await request(`${base}/execute`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: '{"name":"todo-list"}',
		});
		expect(notJson.status).toBe(415);
	});

	it('refuses a body over MAX_BODY_SIZE with 413', async () => {
		const { base } = await start({ MAX_BODY_SIZE: '100' });
		const res = await post(`${base}/execute`, {
			name: 'todo-create',
			args: { title: 'x'.repeat(500) },
		});

		expect(res.status).toBe(413);
		expect(store.count()).toBe(0);
	});
});

describe('POST /chat', () => {
	it('passes the message to the chat backend', async () => {
		const { base } = await start();
		const res = await post(`${base}/chat`, { message: '  hello  ' });
		expect(res.body.message).toBe('echo: hello');
	});

	it('hides unexpected error details but shows public ones', async () => {
		const failing = (error: Error): ChatBackend => ({
			...fakeChat,
			processChat: async () => {
				throw error;
			},
		});

		const hidden = await start({}, { chat: failing(new Error('ECONNREFUSED 10.1.2.3:443')) });
		const internal = await post(`${hidden.base}/chat`, { message: 'hi' });
		expect(internal.status).toBe(500);
		expect(internal.body.error).toBe('Internal server error');

		await stop();
		const shown = await start({}, { chat: failing(new PublicError('Please try again.')) });
		const publicError = await post(`${shown.base}/chat`, { message: 'hi' });
		expect(publicError.body.error).toBe('Please try again.');
	});
});

describe('frontend', () => {
	it('serves the page with a script-restricting Content-Security-Policy', async () => {
		const { base } = await start();
		const res = await request(`${base}/`);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/html');
		expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
		expect(res.text).not.toMatch(/\son[a-z]+=/i);
		expect(res.text).toContain('src="app.js"');
	});

	it('serves only the listed files', async () => {
		const { base } = await start();
		expect((await request(`${base}/render.js`)).status).toBe(200);
		expect((await request(`${base}/package.json`)).status).toBe(404);
		expect((await request(`${base}/..%2Fbackend%2Fpackage.json`)).status).toBe(404);
	});
});
