import { type Server, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { HTTP_EXCLUDED_COMMANDS, createApiServer, isLoopbackHost } from './api.js';

interface ReplyJson {
	success: boolean;
	error: { code: string; message: string };
	data: { commands: Array<{ name: string }> };
}

interface Reply {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
	json: () => ReplyJson;
}

function call(
	server: Server,
	method: string,
	path: string,
	options: { headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
	const { port } = server.address() as AddressInfo;
	return new Promise((resolve, reject) => {
		const req = request(
			{ host: '127.0.0.1', port, method, path, headers: options.headers },
			(res) => {
				let body = '';
				res.on('data', (c) => {
					body += c;
				});
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body,
						json: () => JSON.parse(body),
					}),
				);
			},
		);
		req.on('error', reject);
		req.end(options.body);
	});
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const post = (server: Server, payload: unknown, headers: Record<string, string> = {}) =>
	call(server, 'POST', '/api/command', {
		headers: { ...JSON_HEADERS, ...headers },
		body: typeof payload === 'string' ? payload : JSON.stringify(payload),
	});

describe('REST API server', () => {
	const servers: Server[] = [];
	const start = async (options: Parameters<typeof createApiServer>[0] = {}) => {
		const server = await createApiServer({ port: 0, useMemory: true, silent: true, ...options });
		servers.push(server);
		return server;
	};

	afterEach(async () => {
		await Promise.all(
			servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
		);
	});

	describe('binding', () => {
		it('binds to loopback by default', async () => {
			const server = await start();
			expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
		});

		it('refuses a non-loopback host without a token', async () => {
			await expect(createApiServer({ port: 0, host: '0.0.0.0', silent: true })).rejects.toThrow(
				/without authentication/,
			);
		});

		it('allows a non-loopback host when a token is configured', async () => {
			const server = await start({ host: '0.0.0.0', token: 's3cret' });
			expect((server.address() as AddressInfo).address).toBe('0.0.0.0');
		});

		it('classifies loopback hosts', () => {
			expect(isLoopbackHost('127.0.0.1')).toBe(true);
			expect(isLoopbackHost('localhost')).toBe(true);
			expect(isLoopbackHost('::1')).toBe(true);
			expect(isLoopbackHost('0.0.0.0')).toBe(false);
			expect(isLoopbackHost('192.168.1.5')).toBe(false);
		});
	});

	describe('authentication', () => {
		it('returns 401 without a token when one is configured', async () => {
			const server = await start({ token: 's3cret' });
			const res = await post(server, { command: 'node.list', input: {} });
			expect(res.status).toBe(401);
			expect(res.json().error.code).toBe('UNAUTHORIZED');
			expect((await call(server, 'GET', '/api/commands')).status).toBe(401);
		});

		it('returns 401 for a wrong token', async () => {
			const server = await start({ token: 's3cret' });
			const res = await post(server, { command: 'node.list' }, { Authorization: 'Bearer nope' });
			expect(res.status).toBe(401);
		});

		it('accepts Bearer and X-API-Key tokens', async () => {
			const server = await start({ token: 's3cret' });
			const bearer = await post(
				server,
				{ command: 'node.list', input: {} },
				{ Authorization: 'Bearer s3cret' },
			);
			expect(bearer.status).toBe(200);
			const key = await post(
				server,
				{ command: 'node.list', input: {} },
				{ 'X-API-Key': 's3cret' },
			);
			expect(key.status).toBe(200);
		});

		it('keeps health open and works without a token on loopback when none configured', async () => {
			const server = await start({ token: 's3cret' });
			expect((await call(server, 'GET', '/api/health')).status).toBe(200);
			const open = await start();
			expect((await post(open, { command: 'node.list', input: {} })).status).toBe(200);
		});
	});

	describe('CORS', () => {
		it('never sends a wildcard allow-origin', async () => {
			const server = await start();
			const plain = await call(server, 'GET', '/api/health');
			expect(plain.headers['access-control-allow-origin']).toBeUndefined();

			const preflight = await call(server, 'OPTIONS', '/api/command', {
				headers: { Origin: 'http://localhost:3000' },
			});
			expect(preflight.status).toBe(204);
			expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:3000');
			expect(preflight.headers['access-control-allow-origin']).not.toBe('*');
		});

		it('rejects origins outside the allow-list (preflight and simple requests)', async () => {
			const server = await start();
			const preflight = await call(server, 'OPTIONS', '/api/command', {
				headers: { Origin: 'https://evil.example' },
			});
			expect(preflight.status).toBe(403);
			expect(preflight.headers['access-control-allow-origin']).toBeUndefined();

			const res = await post(
				server,
				{ command: 'node.list', input: {} },
				{ Origin: 'https://evil.example', 'Content-Type': 'text/plain' },
			);
			expect(res.status).toBe(403);
		});

		it('honours a custom allow-list and ignores a wildcard entry', async () => {
			const server = await start({ corsOrigins: ['https://app.example', '*'] });
			const ok = await call(server, 'GET', '/api/health', {
				headers: { Origin: 'https://app.example' },
			});
			expect(ok.headers['access-control-allow-origin']).toBe('https://app.example');
			const denied = await call(server, 'GET', '/api/health', {
				headers: { Origin: 'http://localhost:3000' },
			});
			expect(denied.status).toBe(403);
		});

		it('rejects unexpected Host headers on loopback (DNS rebinding)', async () => {
			const server = await start();
			const res = await call(server, 'GET', '/api/health', { headers: { Host: 'evil.example' } });
			expect(res.status).toBe(403);
		});
	});

	describe('request validation', () => {
		it('returns 413 for oversized bodies', async () => {
			const server = await start({ maxBodyBytes: 256 });
			const res = await post(server, {
				command: 'node.create',
				input: { name: 'x'.repeat(1000) },
			});
			expect(res.status).toBe(413);
			expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
		});

		it('returns 413 for oversized chunked bodies without content-length', async () => {
			const server = await start({ maxBodyBytes: 256 });
			const res = await call(server, 'POST', '/api/command', {
				headers: { ...JSON_HEADERS, 'Transfer-Encoding': 'chunked' },
				body: JSON.stringify({ command: 'x', input: 'y'.repeat(2000) }),
			});
			expect(res.status).toBe(413);
		});

		it('returns 400 for invalid JSON', async () => {
			const server = await start();
			const res = await post(server, '{not json');
			expect(res.status).toBe(400);
			expect(res.json().error.code).toBe('INVALID_JSON');
		});

		it.each(['null', '42', '"str"', '[1,2]'])(
			'returns 400 for non-object body %s',
			async (body) => {
				const server = await start();
				const res = await post(server, body);
				expect(res.status).toBe(400);
				expect(res.json().error.code).toBe('INVALID_BODY');
			},
		);

		it('returns 400 when the command is missing or not a string', async () => {
			const server = await start();
			expect((await post(server, {})).status).toBe(400);
			expect((await post(server, { command: 5 })).status).toBe(400);
		});

		it('returns 404 for unknown commands', async () => {
			const server = await start();
			expect((await post(server, { command: 'nope.nothing' })).status).toBe(404);
		});
	});

	describe('command exposure', () => {
		it('excludes validate and doctor from execution', async () => {
			const server = await start();
			for (const command of HTTP_EXCLUDED_COMMANDS) {
				const res = await post(server, { command, input: {} });
				expect(res.status).toBe(403);
				expect(res.json().error.code).toBe('COMMAND_NOT_ALLOWED');
			}
			expect(HTTP_EXCLUDED_COMMANDS.has('validate')).toBe(true);
			expect(HTTP_EXCLUDED_COMMANDS.has('doctor')).toBe(true);
		});

		it('excludes validate and doctor from the command listing', async () => {
			const server = await start();
			const res = await call(server, 'GET', '/api/commands');
			const names = res.json().data.commands.map((c: { name: string }) => c.name);
			expect(names).toContain('node.create');
			expect(names).not.toContain('validate');
			expect(names).not.toContain('doctor');
		});

		it('still executes normal commands', async () => {
			const server = await start();
			const created = await post(server, {
				command: 'node.create',
				input: { name: 'brand', type: 'root' },
			});
			expect(created.status).toBe(200);
			expect(created.json().success).toBe(true);
		});

		it('serves analyze.health and audit.list', async () => {
			const server = await start();
			await post(server, { command: 'node.create', input: { name: 'brand', type: 'root' } });
			await post(server, {
				command: 'node.create',
				input: { name: 'brand-dark', parentId: 'brand', type: 'theme' },
			});

			const listed = (await call(server, 'GET', '/api/commands'))
				.json()
				.data.commands.map((c: { name: string }) => c.name);
			expect(listed).toEqual(expect.arrayContaining(['analyze.health', 'audit.list']));

			const health = await post(server, { command: 'analyze.health', input: { rootId: 'brand' } });
			expect(health.status).toBe(200);
			const healthData = JSON.parse(health.body).data;
			expect(healthData.nodes.map((node: { id: string }) => node.id)).toEqual([
				'brand',
				'brand-dark',
			]);

			const audit = await post(server, {
				command: 'audit.list',
				input: { nodeId: 'brand', subtree: true, eventTypes: ['node_created'] },
			});
			expect(audit.status).toBe(200);
			expect(JSON.parse(audit.body).data.summary.total).toBe(2);
		});
	});
});
