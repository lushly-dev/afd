import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setStore, TodoStore } from '@afd/example-todo-ts/store';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ChatBackend, type ChatServer, createChatServer, PublicError } from './chat-http.js';
import { type Env, loadChatServerConfig } from './http-security.js';

/** A built page stand-in: what `vite build` writes, and a file beside it that must stay private. */
let site: string;
beforeAll(() => {
	site = mkdtempSync(join(tmpdir(), 'todo-page-'));
	mkdirSync(join(site, 'dist', 'assets'), { recursive: true });
	writeFileSync(
		join(site, 'dist', 'index.html'),
		'<!doctype html><script type="module" src="/assets/index-abc.js"></script>'
	);
	writeFileSync(join(site, 'dist', 'assets', 'index-abc.js'), 'export {};');
	writeFileSync(join(site, 'dist', 'assets', 'notes.txt'), 'not a page file');
	writeFileSync(join(site, 'secret.js'), 'outside dist');
});
afterAll(() => rmSync(site, { recursive: true, force: true }));

interface Reply {
	status: number;
	headers: Headers;
	body: Record<string, unknown>;
	text: string;
}

const fakeChat: ChatBackend = {
	processChat: async (message, mode) => ({ message: `echo: ${message}`, mode, toolExecutions: [] }),
	isConfigured: () => true,
	getMetrics: () => ({ requestCount: 0 }),
};

let running: ChatServer | undefined;

async function start(env: Env = {}, deps: Partial<Parameters<typeof createChatServer>[1]> = {}) {
	const config = loadChatServerConfig(env);
	running = createChatServer(config, {
		chat: fakeChat,
		frontendDir: join(site, 'dist'),
		onError: () => {},
		...deps,
	});
	const { server } = running;
	// Port 0 picks a free port; the host is the configured default bind address.
	await new Promise<void>((resolve) => server.listen(0, config.host, resolve));
	const address = server.address() as AddressInfo;
	return { address, base: `http://127.0.0.1:${address.port}`, config };
}

/** The events of a streamed turn. */
function lines(text: string): Record<string, unknown>[] {
	return text
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>);
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

let store: TodoStore;

beforeEach(() => {
	store = new TodoStore();
	setStore(store);
});

afterEach(async () => {
	await stop();
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
			`${base}/chat`,
			{ message: 'Clear everything' },
			{ Origin: 'https://evil.example' }
		);

		expect(res.status).toBe(403);
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
		expect(store.count()).toBe(0);
	});

	it('rejects the null origin', async () => {
		const { base } = await start();
		const res = await post(`${base}/chat`, { message: 'hi' }, { Origin: 'null' });
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
		const { base } = await start({ RATE_LIMIT_CHAT: '2' });
		const statuses: number[] = [];
		for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
			const res = await post(`${base}/chat`, { message: 'hi' }, { 'X-Forwarded-For': ip });
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
		const { base } = await start({ RATE_LIMIT_CHAT: '1', TRUST_PROXY: 'true' });
		const first = await post(
			`${base}/chat`,
			{ message: 'hi' },
			{ 'X-Forwarded-For': 'a, 1.1.1.1' }
		);
		const second = await post(
			`${base}/chat`,
			{ message: 'hi' },
			{ 'X-Forwarded-For': 'b, 2.2.2.2' }
		);
		// Same client behind the proxy, spoofed first entry: still limited.
		const spoofed = await post(
			`${base}/chat`,
			{ message: 'hi' },
			{ 'X-Forwarded-For': 'c, 2.2.2.2' }
		);

		expect([first.status, second.status, spoofed.status]).toEqual([200, 200, 429]);
	});
});

describe('requests', () => {
	it('rejects malformed ones', async () => {
		const { base } = await start();

		expect((await post(`${base}/chat`, { message: 42 })).status).toBe(400);
		expect((await post(`${base}/chat`, ['hi'])).status).toBe(400);
		const notJson = await request(`${base}/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: '{"message":"hi"}',
		});
		expect(notJson.status).toBe(415);
	});

	it('refuses a body over MAX_BODY_SIZE with 413', async () => {
		const { base } = await start({ MAX_BODY_SIZE: '100' });
		const res = await post(`${base}/chat`, { message: 'x'.repeat(500) });
		expect(res.status).toBe(413);
	});
});

describe('POST /chat/answer', () => {
	it('refuses an answer that is neither an approval nor a command result', async () => {
		const { base } = await start();
		expect((await post(`${base}/chat/answer`, { turn: 't', ask: 1 })).status).toBe(400);
		expect(
			(await post(`${base}/chat/answer`, { turn: 't', ask: 'one', approved: true })).status
		).toBe(400);
		expect(
			(await post(`${base}/chat/answer`, { turn: 't', ask: 1, result: { data: 1 } })).status
		).toBe(400);
	});

	it('answers 404 for a question no turn is waiting on', async () => {
		const { base } = await start();
		const res = await post(`${base}/chat/answer`, { turn: 'no-such-turn', ask: 1, approved: true });
		expect(res.status).toBe(404);
		expect(res.body.suggestion).toBeDefined();
	});
});

describe('POST /chat', () => {
	it('streams the turn as JSON lines: its id, then the answer', async () => {
		const { base } = await start();
		const res = await post(`${base}/chat`, { message: '  hello  ' });
		expect(res.headers.get('content-type')).toContain('application/x-ndjson');
		const events = lines(res.text);
		expect(events).toMatchObject([
			{ type: 'turn', turn: expect.any(String) },
			{ type: 'done', message: 'echo: hello', mode: 'change' },
		]);
	});

	it('passes the mode, and refuses one it does not know', async () => {
		const { base } = await start();
		const look = lines((await post(`${base}/chat`, { message: 'hi', mode: 'look' })).text);
		expect(look.at(-1)).toMatchObject({ type: 'done', mode: 'look' });
		const unknown = await post(`${base}/chat`, { message: 'hi', mode: 'admin' });
		expect(unknown.status).toBe(400);
		expect(unknown.body.suggestion).toBe('Use one of: change, look');
	});

	it('cancels the turn when the page goes away', async () => {
		let signal: AbortSignal | undefined;
		const { base } = await start(
			{},
			{
				chat: {
					...fakeChat,
					processChat: (_message, _mode, options) => {
						const turnSignal = options?.signal;
						signal = turnSignal;
						// Never answers: only the page leaving ends it
						return new Promise((_resolve, reject) =>
							turnSignal?.addEventListener('abort', () => reject(turnSignal.reason))
						);
					},
				},
			}
		);
		const leave = new AbortController();
		const sent = fetch(`${base}/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message: 'hi' }),
			signal: leave.signal,
		}).catch(() => undefined);
		await expect.poll(() => signal).toBeDefined();
		leave.abort();
		await sent;
		await expect.poll(() => signal?.aborted).toBe(true);
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
		expect(lines(internal.text).at(-1)).toEqual({ type: 'error', error: 'Internal server error' });
		expect(internal.text).not.toContain('10.1.2.3');

		await stop();
		const shown = await start({}, { chat: failing(new PublicError('Please try again.')) });
		const publicError = await post(`${shown.base}/chat`, { message: 'hi' });
		expect(lines(publicError.text).at(-1)).toEqual({ type: 'error', error: 'Please try again.' });
	});
});

describe('/mcp', () => {
	const initialize = {
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'test', version: '1.0.0' },
		},
	};

	it('is checked for Host and Origin before MCP sees the request', async () => {
		let reached = false;
		const { base } = await start(
			{},
			{
				mcp: async (_req, res) => {
					reached = true;
					res.end();
				},
			}
		);
		const res = await request(`${base}/mcp`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
			body: JSON.stringify(initialize),
		});
		expect(res.status).toBe(403);
		expect(reached).toBe(false);
	});
});

describe('frontend', () => {
	it('serves the page with a script-restricting Content-Security-Policy', async () => {
		const { base } = await start();
		const res = await request(`${base}/`);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/html');
		expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
		expect(res.text).toContain('/assets/index-abc.js');
	});

	it("serves the build's own files and nothing else", async () => {
		const { base } = await start();
		const script = await request(`${base}/assets/index-abc.js`);
		expect(script.status).toBe(200);
		expect(script.headers.get('content-type')).toContain('text/javascript');
		expect((await request(`${base}/assets/notes.txt`)).status).toBe(404);
		expect((await request(`${base}/assets/missing.js`)).status).toBe(404);
		expect((await request(`${base}/..%2Fsecret.js`)).status).toBe(404);
		expect((await request(`${base}/%E0%A4%A`)).status).toBe(404);
	});
});
