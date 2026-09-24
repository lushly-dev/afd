/**
 * @fileoverview Browser-facing limits of the chat example: the MCP `/rpc`
 * route the demo uses, and the WebSocket server.
 */

import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMcpHandler } from '@lushly-dev/afd-server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { allCommands } from './commands/index.js';
import { createChatMcpOptions, demoOrigins, type Env, loadChatConfig } from './config.js';
import { chatService } from './services/chat.js';
import { type ChatRealtimeServer, createWebSocketServer } from './ws-server.js';

const DEMO_ORIGIN = 'http://localhost:3001';

beforeEach(() => {
	chatService.clear();
});

describe('loadChatConfig', () => {
	it('is local-only by default', () => {
		const config = loadChatConfig({});

		expect(config.host).toBe('127.0.0.1');
		expect(config.allowedOrigins).toEqual(demoOrigins(3001));
		expect(config.maxBodyBytes).toBe(64 * 1024);
		expect(config.wsMaxPayload).toBe(16 * 1024);
		expect(config.devMode).toBe(false);
	});

	it('adds exact origins from ALLOWED_ORIGINS', () => {
		const config = loadChatConfig({ ALLOWED_ORIGINS: 'http://localhost:5173' });
		expect(config.allowedOrigins).toContain('http://localhost:5173');
		expect(config.allowedOrigins).toContain(DEMO_ORIGIN);
	});

	it.each(['*', 'null', 'localhost:5173', 'http://localhost:5173/app'])(
		'refuses ALLOWED_ORIGINS=%s',
		(origin) => {
			expect(() => loadChatConfig({ ALLOWED_ORIGINS: origin })).toThrow(/ALLOWED_ORIGINS/);
		}
	);
});

// ═══════════════════════════════════════════════════════════════════════════════
// MCP /rpc: what the browser demo calls instead of the old side server
// ═══════════════════════════════════════════════════════════════════════════════

describe('MCP /rpc route', () => {
	let server: Server | undefined;

	afterEach(async () => {
		const running = server;
		server = undefined;
		if (!running) return;
		running.closeAllConnections();
		await new Promise<void>((resolve) => running.close(() => resolve()));
	});

	async function start(env: Env = {}): Promise<string> {
		const handler = createMcpHandler(createChatMcpOptions(loadChatConfig(env), allCommands));
		server = createServer(handler);
		await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
		return `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
	}

	function rpc(url: string, params: unknown, origin?: string, method = 'chat-connect') {
		return fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		});
	}

	it('runs chat-connect for the demo origin with a matching CORS header', async () => {
		const url = await start();
		const res = await rpc(url, { roomId: 'general', nickname: 'Demo' }, DEMO_ORIGIN);
		const body = (await res.json()) as { result: { success: boolean; data: { protocol: string } } };

		expect(res.status).toBe(200);
		expect(res.headers.get('access-control-allow-origin')).toBe(DEMO_ORIGIN);
		expect(body.result.success).toBe(true);
		expect(body.result.data.protocol).toBe('websocket');
	});

	it('validates input with the command schema before the handler runs', async () => {
		const url = await start();
		const res = await rpc(url, { roomId: { nested: true } }, DEMO_ORIGIN);
		const body = (await res.json()) as { result: { success: boolean; error: { code: string } } };

		expect(body.result.success).toBe(false);
		expect(body.result.error.code).toBe('VALIDATION_ERROR');
	});

	it('refuses other origins and the null origin', async () => {
		const url = await start();
		const evil = await rpc(url, { roomId: 'general' }, 'https://evil.example');
		const nullOrigin = await rpc(url, { roomId: 'general' }, 'null');

		expect(evil.status).toBe(403);
		expect(evil.headers.get('access-control-allow-origin')).toBeNull();
		expect(nullOrigin.status).toBe(403);
	});

	it('caps the request body', async () => {
		const url = await start({ MAX_BODY_BYTES: '1024' });
		const res = await rpc(url, { roomId: 'general', nickname: 'x'.repeat(2000) }, DEMO_ORIGIN);

		expect(res.status).toBe(413);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// WebSocket server
// ═══════════════════════════════════════════════════════════════════════════════

describe('WebSocket server', () => {
	let realtime: ChatRealtimeServer | undefined;

	afterEach(async () => {
		await realtime?.close();
		realtime = undefined;
	});

	async function start(options: Parameters<typeof createWebSocketServer>[0] = {}) {
		realtime = createWebSocketServer({ port: 0, allowedOrigins: [DEMO_ORIGIN], ...options });
		return realtime.ready;
	}

	function roomUrl(port: number): string {
		const session = chatService.createSession({
			roomId: 'general',
			userId: 'user-1',
			nickname: 'Tester',
		});
		return `ws://127.0.0.1:${port}/rooms/general?token=${session.token}`;
	}

	/** Resolve with the first message, or reject with the refused upgrade's status. */
	function connect(url: string, origin?: string): Promise<{ ws: WebSocket; first: unknown }> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(url, origin ? { origin } : {});
			ws.once('message', (data) => resolve({ ws, first: JSON.parse(String(data)) }));
			ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
			ws.once('error', reject);
		});
	}

	function nextEvent(ws: WebSocket): Promise<{ message?: unknown; closeCode?: number }> {
		return new Promise((resolve) => {
			ws.once('message', (data) => resolve({ message: JSON.parse(String(data)) }));
			ws.once('close', (code) => resolve({ closeCode: code }));
		});
	}

	it('binds 127.0.0.1 by default', async () => {
		const address = await start();
		expect(address.address).toBe('127.0.0.1');
	});

	it('accepts the demo origin with a valid handoff token', async () => {
		const { port } = await start();
		const { ws, first } = await connect(roomUrl(port), DEMO_ORIGIN);

		expect(first).toMatchObject({ type: 'welcome', roomId: 'general' });
		ws.close();
	});

	it('refuses upgrades from other origins and the null origin', async () => {
		const { port } = await start();

		await expect(connect(roomUrl(port), 'https://evil.example')).rejects.toThrow('HTTP 403');
		await expect(connect(roomUrl(port), 'null')).rejects.toThrow('HTTP 403');
	});

	it('closes the connection when a message exceeds maxPayload', async () => {
		const { port } = await start({ maxPayload: 1024 });
		const { ws } = await connect(roomUrl(port), DEMO_ORIGIN);

		const event = nextEvent(ws);
		ws.send(JSON.stringify({ type: 'message', text: 'x'.repeat(4096) }));

		expect(await event).toEqual({ closeCode: 1009 });
	});

	it('uses a 16 KiB maxPayload by default', async () => {
		await start();
		expect(realtime?.wss.options.maxPayload).toBe(16 * 1024);
	});

	it('rejects chat text over 2000 characters', async () => {
		const { port } = await start();
		const { ws } = await connect(roomUrl(port), DEMO_ORIGIN);

		const event = nextEvent(ws);
		ws.send(JSON.stringify({ type: 'message', text: 'x'.repeat(2001) }));

		expect(await event).toEqual({
			message: { type: 'error', message: 'Message text is limited to 2000 characters' },
		});
		ws.close();
	});

	it('serves the demo page with a script-restricting CSP', async () => {
		const { port } = await start();
		const res = await fetch(`http://127.0.0.1:${port}/`);
		const html = await res.text();

		expect(res.status).toBe(200);
		expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
		expect(html).toContain('src="demo.js"');
		expect(html).not.toMatch(/\son[a-z]+=/i);
		expect((await fetch(`http://127.0.0.1:${port}/package.json`)).status).toBe(404);
	});

	it('refuses a Host header that does not name this server (DNS rebinding)', async () => {
		const { port } = await start();
		const status = await new Promise<number>((resolve, reject) => {
			const req = httpRequest(
				{ host: '127.0.0.1', port, path: '/', headers: { Host: `rebind.evil.example:${port}` } },
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
