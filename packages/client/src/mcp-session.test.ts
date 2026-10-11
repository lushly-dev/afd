import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { McpRequest } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it } from 'vitest';
import { McpSession } from './mcp-session.js';
import { HttpTransport, SseTransport } from './transport.js';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}

interface Reply {
	status?: number;
	session?: string;
	body: unknown;
}
interface Received {
	request: McpRequest;
	session: string | undefined;
}
const cleanup: Array<() => Promise<void>> = [];

async function fixture(reply: (received: Received) => Promise<Reply> | Reply) {
	const received: Received[] = [];
	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		void (async () => {
			let body = '';
			for await (const part of req) body += part;
			const entry = {
				request: JSON.parse(body) as McpRequest,
				session: req.headers['mcp-session-id'] as string | undefined,
			};
			received.push(entry);
			const response = await reply(entry);
			res.writeHead(response.status ?? 200, {
				'Content-Type': 'application/json',
				...(response.session !== undefined ? { 'Mcp-Session-Id': response.session } : {}),
			});
			res.end(typeof response.body === 'string' ? response.body : JSON.stringify(response.body));
		})().catch(() => {
			res.writeHead(500);
			res.end();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Missing fixture port');
	cleanup.push(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	});
	return { url: `http://127.0.0.1:${address.port}/message`, received };
}

const initialize: McpRequest = { jsonrpc: '2.0', id: 1, method: 'initialize' };
const call = (id: number): McpRequest => ({
	jsonrpc: '2.0',
	id,
	method: 'tools/call',
	params: { name: 'item-get' },
});
const result = (id: string | number | undefined) => ({ jsonrpc: '2.0', id, result: {} });
const expired = (id: string | number | undefined): Reply => ({
	status: 404,
	body: { jsonrpc: '2.0', id, error: { code: -32001, message: 'Session expired' } },
});

afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((close) => close()));
});

describe.each([
	['HTTP', (url: string) => new HttpTransport(url)],
	['SSE POST', (url: string) => new SseTransport(url.replace('/message', '/sse'))],
] as const)('%s session renewal over loopback HTTP', (_name, create) => {
	it.each([
		['HTTP failure', { status: 503, session: 'bad', body: result(1) }],
		[
			'JSON-RPC error',
			{
				session: 'bad',
				body: { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Failed' } },
			},
		],
		['malformed JSON', { session: 'bad', body: '{' }],
		['missing result', { session: 'bad', body: { jsonrpc: '2.0', id: 1 } }],
		['wrong response ID', { session: 'bad', body: result(999) }],
		['non-object result', { session: 'bad', body: { jsonrpc: '2.0', id: 1, result: null } }],
		['missing session', { body: result(1) }],
		['empty session', { session: '', body: result(1) }],
	] satisfies Array<[string, Reply]>)(
		'rejects %s without replaying statelessly',
		async (_failure, failedReply) => {
			let initializes = 0;
			const server = await fixture(({ request }) =>
				request.method === 'initialize'
					? ++initializes === 1
						? { session: 'old', body: result(request.id) }
						: failedReply
					: expired(request.id)
			);
			const transport = create(server.url);
			await transport.send(initialize);
			expect((await transport.send(call(2))).error?.code).toBe(-32001);
			expect(transport.sessionId).toBe('old');
			// The next request must also carry the rejected session, never silently become stateless.
			expect((await transport.send(call(3))).error?.code).toBe(-32001);
			expect(
				server.received
					.filter((entry) => entry.request.method === 'tools/call')
					.map((entry) => entry.session)
			).toEqual(['old', 'old']);
			expect(initializes).toBe(3);
			transport.disconnect();
		}
	);

	it.each([true, false])(
		'shares concurrent renewals (success: %s) and only replays after success',
		async (succeeds) => {
			const renewalStarted = deferred<void>();
			const releaseRenewal = deferred<void>();
			const allOldRequests = deferred<void>();
			let initializes = 0;
			let oldRequests = 0;
			const server = await fixture(async ({ request, session }) => {
				if (request.method === 'initialize') {
					if (++initializes === 1) return { session: 'old', body: result(request.id) };
					renewalStarted.resolve();
					await releaseRenewal.promise;
					return succeeds
						? { session: 'new', body: result(request.id) }
						: { status: 503, body: {} };
				}
				if (session === 'old') {
					if (++oldRequests === 2) allOldRequests.resolve();
					return expired(request.id);
				}
				return { body: result(request.id) };
			});
			const transport = create(server.url);
			await transport.send(initialize);
			const requests = [transport.send(call(2)), transport.send(call(3))];
			await Promise.all([renewalStarted.promise, allOldRequests.promise]);
			releaseRenewal.resolve();
			const responses = await Promise.all(requests);
			expect(responses.map((response) => response.id)).toEqual([2, 3]);
			expect(responses.map((response) => response.error?.code)).toEqual(
				succeeds ? [undefined, undefined] : [-32001, -32001]
			);
			expect(initializes).toBe(2);
			expect(
				server.received
					.filter((entry) => entry.request.method === 'tools/call')
					.map((entry) => entry.session)
			).toEqual(succeeds ? ['old', 'old', 'new', 'new'] : ['old', 'old']);
			transport.disconnect();
		}
	);

	it('keeps another caller renewal alive when the first waiter cancels', async () => {
		const renewalStarted = deferred<void>();
		const releaseRenewal = deferred<void>();
		let initializes = 0;
		const server = await fixture(async ({ request }) => {
			if (++initializes === 1) return { session: 'old', body: result(request.id) };
			renewalStarted.resolve();
			await releaseRenewal.promise;
			return { session: 'new', body: result(request.id) };
		});
		const transport = create(server.url);
		await transport.send(initialize);
		const controller = new AbortController();
		const first = transport.renewSession(controller.signal);
		const rejected = expect(first).rejects.toThrow('cancelled');
		const second = transport.renewSession();
		await renewalStarted.promise;
		controller.abort(new Error('cancelled'));
		await rejected;
		releaseRenewal.resolve();
		expect(await second).toBe(true);
		expect(transport.sessionId).toBe('new');
		expect(initializes).toBe(2);
		transport.disconnect();
	});

	it('invalidates a pending renewal on disconnect and preserves the next connection session', async () => {
		const started = deferred<void>();
		const release = deferred<void>();
		let initializes = 0;
		const server = await fixture(async ({ request }) => {
			const count = ++initializes;
			if (count === 2) {
				started.resolve();
				await release.promise;
			}
			return {
				session: count === 1 ? 'old' : count === 2 ? 'stale' : 'current',
				body: result(request.id),
			};
		});
		const transport = create(server.url);
		await transport.send(initialize);
		const renewing = transport.renewSession();
		const rejected = expect(renewing).rejects.toThrow();
		await started.promise;
		transport.disconnect();
		await rejected;
		expect(transport.sessionId).toBeUndefined();
		await transport.send({ ...initialize, id: 4 });
		release.resolve();
		expect(transport.sessionId).toBe('current');
		transport.disconnect();
	});
});

describe('McpSession generation ownership', () => {
	it('ignores a late initialize response after reset and a new initialize', async () => {
		const started = deferred<void>();
		const release = deferred<void>();
		const server = await fixture(async ({ request }) => {
			if (request.id === 1) {
				started.resolve();
				await release.promise;
			}
			return { session: request.id === 1 ? 'stale' : 'current', body: result(request.id) };
		});
		const session = new McpSession();
		const old = session.post(server.url, undefined, initialize, new AbortController().signal);
		await started.promise;
		session.reset();
		const current = await session.post(
			server.url,
			undefined,
			{ ...initialize, id: 4 },
			new AbortController().signal
		);
		await current.body?.cancel();
		release.resolve();
		await (await old).body?.cancel();
		expect(session.sessionId).toBe('current');
	});
});
