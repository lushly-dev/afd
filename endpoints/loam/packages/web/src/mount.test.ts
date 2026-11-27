import type { StreamableHttpTransportOptions } from '@lushly-dev/afd-client/streamable-http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	boundedFetch,
	createMountTransport,
	MOUNT_FAILURE_CODES,
	RESPONSE_MAX_BYTES,
	refusalOf,
} from './mount.js';

/** What the AFD transport does, as far as the port reads it. */
function fakeTransport(behaviour: {
	connect?: () => Promise<void>;
	send?: (request: { method: string; params: unknown }) => Promise<unknown>;
	protocolVersion?: string | undefined;
}) {
	const seen: { url?: string; options?: StreamableHttpTransportOptions; disconnects: number } = {
		disconnects: 0,
	};
	class Fake {
		constructor(url: string, options: StreamableHttpTransportOptions) {
			seen.url = url;
			seen.options = options;
		}
		connect = behaviour.connect ?? (() => Promise.resolve());
		disconnect() {
			seen.disconnects++;
		}
		send = (request: never) => behaviour.send?.(request) as never;
		get protocolVersion() {
			return 'protocolVersion' in behaviour ? behaviour.protocolVersion : '2026-07-28';
		}
	}
	return { seen, Fake: Fake as never };
}

const httpError = (status: number, message = 'with a body naming /srv/state/keys/http.token') =>
	Object.assign(new Error(message), { data: { status } });

describe('createMountTransport', () => {
	it('sets no header, so no credential can be in the page', () => {
		const { seen, Fake } = fakeTransport({});
		createMountTransport('https://shell/mounts/work/mcp', Fake);
		expect(seen.url).toBe('https://shell/mounts/work/mcp');
		expect(seen.options?.headers).toBeUndefined();
		expect(seen.options?.mode).toBe('auto');
		expect(seen.options?.onElicitation).toBeUndefined();
		expect(seen.options?.fetch).toBe(boundedFetch);
	});

	it('answers a connection with its negotiated version', async () => {
		const { Fake } = fakeTransport({});
		await expect(createMountTransport('u', Fake).connect()).resolves.toEqual({
			protocolVersion: '2026-07-28',
		});
	});

	it('refuses a connection that negotiated no version, since the port promises a string', async () => {
		const { Fake } = fakeTransport({ protocolVersion: undefined });
		await expect(createMountTransport('u', Fake).connect()).rejects.toMatchObject({
			code: 'MOUNT_UNREACHABLE',
		});
	});

	it.each([
		[401, 'MOUNT_UNAUTHORIZED'],
		[403, 'MOUNT_UNAUTHORIZED'],
		[404, 'MOUNT_UNREACHABLE'],
		[405, 'MOUNT_UNREACHABLE'],
		[502, 'MOUNT_UNREACHABLE'],
	])('reads an HTTP %i as %s, and keeps none of its text', async (status, code) => {
		const { Fake } = fakeTransport({ connect: () => Promise.reject(httpError(status)) });
		const refused = await createMountTransport('u', Fake)
			.connect()
			.catch((error: Error) => error);
		expect(refused).toMatchObject({ code });
		expect((refused as Error).message).not.toContain('token');
	});

	it('reads a status from a message when the SDK wrote it only there', async () => {
		const { Fake } = fakeTransport({
			connect: () => Promise.reject(new Error('Error POSTing to endpoint (HTTP 401): secret path')),
		});
		await expect(createMountTransport('u', Fake).connect()).rejects.toMatchObject({
			code: 'MOUNT_UNAUTHORIZED',
		});
	});

	it('reads a network failure as unreachable', async () => {
		const { Fake } = fakeTransport({
			connect: () => Promise.reject(new TypeError('fetch failed')),
		});
		await expect(createMountTransport('u', Fake).connect()).rejects.toMatchObject({
			code: 'MOUNT_UNREACHABLE',
		});
	});

	it('follows pages of tools/list, and stops however many a server offers', async () => {
		let pages = 0;
		const { Fake } = fakeTransport({
			send: async () => {
				pages++;
				return { result: { tools: [{ name: `tool-${pages}` }], nextCursor: 'more' } };
			},
		});
		const tools = await createMountTransport('u', Fake).listTools();
		expect(pages).toBe(20);
		expect(tools).toHaveLength(20);
	});

	it('sends a tool call by name, and takes a JSON-RPC error as no result, without its text', async () => {
		const sent: unknown[] = [];
		const { Fake } = fakeTransport({
			send: async (request) => {
				sent.push(request);
				return { error: { code: -32602, message: 'a message from the server' } };
			},
		});
		const refused = await createMountTransport('u', Fake)
			.callTool('hello-greet', { name: 'Ada' })
			.catch((error: Error) => error);
		expect(sent[0]).toMatchObject({
			method: 'tools/call',
			params: { name: 'hello-greet', arguments: { name: 'Ada' } },
		});
		expect(refused).toMatchObject({ code: 'MOUNT_RESULT_INVALID' });
		expect((refused as Error).message).not.toContain('server');
	});

	it("P2-E6: (unit) puts a command call's meta in `_meta`, and sends none without it (9.2)", async () => {
		const sent: Array<{ params: Record<string, unknown> }> = [];
		const { Fake } = fakeTransport({
			send: async (request) => {
				sent.push(request as never);
				return { result: { structuredContent: { success: true } } };
			},
		});
		const port = createMountTransport('u', Fake);
		const scope = { workspace: 'personal', project: 'prj_atlas0000' };
		await port.callTool('afd-call', { command: 'hello-greet' }, undefined, {
			'dev.loam/scope': scope,
		});
		await port.callTool('afd-help', { format: 'full' });
		expect(sent[0]?.params).toEqual({
			name: 'afd-call',
			arguments: { command: 'hello-greet' },
			_meta: { 'dev.loam/scope': scope },
		});
		expect(Object.keys(sent[1]?.params ?? {})).toEqual(['name', 'arguments']);
	});

	it('closes at once: disconnect is synchronous', async () => {
		const { seen, Fake } = fakeTransport({});
		await createMountTransport('u', Fake).close();
		expect(seen.disconnects).toBe(1);
	});
});

describe('boundedFetch: a server is untrusted', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('opens no event stream: a GET is answered here, and no request leaves', async () => {
		const sent = vi.fn();
		vi.stubGlobal('fetch', sent);
		const answer = await boundedFetch('https://shell/mounts/work/mcp', { method: 'GET' });
		expect(answer.status).toBe(405);
		expect(sent).not.toHaveBeenCalled();
	});

	it('passes a request and an answer of ordinary size unchanged', async () => {
		const sent = vi.fn(
			async () =>
				new Response('{"ok":true}', {
					status: 200,
					headers: { 'content-type': 'application/json' },
				})
		);
		vi.stubGlobal('fetch', sent);
		const answer = await boundedFetch('https://shell/mounts/work/mcp', {
			method: 'POST',
			body: '{}',
		});
		expect(sent).toHaveBeenCalledOnce();
		expect(answer.status).toBe(200);
		expect(answer.headers.get('content-type')).toBe('application/json');
		expect(await answer.json()).toEqual({ ok: true });
	});

	it('stops reading past the limit, however the answer is framed', async () => {
		const chunk = new Uint8Array(1024 * 1024);
		let sent = 0;
		const endless = new ReadableStream<Uint8Array>({
			pull(controller) {
				sent += chunk.byteLength;
				controller.enqueue(chunk);
			},
		});
		vi.stubGlobal('fetch', async () => new Response(endless, { status: 200 }));
		const answer = await boundedFetch('u', { method: 'POST' });
		await expect(answer.text()).rejects.toMatchObject({ code: 'MOUNT_RESULT_INVALID' });
		expect(sent).toBeLessThan(RESPONSE_MAX_BYTES + 8 * chunk.byteLength);
	});
});

describe("P6-E5: `mount.ts`'s mapping of the hosted relay's answers (8.1)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const marked = (status: number, body: unknown, mark = true) =>
		new Response(typeof body === 'string' ? body : JSON.stringify(body), {
			status,
			headers: {
				'content-type': 'application/json',
				...(mark ? { 'loam-relay-refusal': '1' } : {}),
			},
		});

	it("P6-E5: the transport's codes are the kernel's `MountFailureCode`s, exactly", async () => {
		const { MOUNT_FAILURE_CODES: kernel } = await import('@lushly-dev/loam-kernel/mounted');
		expect([...MOUNT_FAILURE_CODES].sort()).toEqual([...kernel].sort());
	});

	it('P6-E5: a body code is read only under `Loam-Relay-Refusal: 1`, and never its message or suggestion', async () => {
		vi.stubGlobal('fetch', async () =>
			marked(403, { code: 'MOUNT_SPACE_PINNED', message: 'relay words', suggestion: 'x' })
		);
		const refused = await boundedFetch('u', { method: 'POST' }).catch((error: Error) => error);
		expect(refused).toMatchObject({ code: 'MOUNT_SPACE_PINNED', message: 'MOUNT_SPACE_PINNED' });
		vi.stubGlobal('fetch', async () => marked(403, { code: 'MOUNT_SPACE_PINNED' }, false));
		const passed = await boundedFetch('u', { method: 'POST' });
		expect(passed.status).toBe(403);
	});

	it('P6-E5: a code outside the set, or a body that is not such JSON, under the mark is MOUNT_UNREACHABLE; at most 4 KiB is read', async () => {
		for (const body of [
			{ code: 'DROP_TABLES' },
			'not json',
			{ code: 7 },
			`{"code":"${'x'.repeat(8192)}"}`,
		]) {
			vi.stubGlobal('fetch', async () => marked(400, body));
			await expect(boundedFetch('u', { method: 'POST' })).rejects.toMatchObject({
				code: 'MOUNT_UNREACHABLE',
			});
		}
	});

	it('P6-E5: a `MountRefusal` passes through `refusalOf` unchanged from anywhere on its `cause` chain', async () => {
		vi.stubGlobal('fetch', async () => marked(404, { code: 'MOUNT_SESSION_UNKNOWN' }));
		const refusal = await boundedFetch('u', { method: 'POST' }).catch((error: Error) => error);
		const wrapped = new Error('HTTP 404', { cause: new Error('again', { cause: refusal }) });
		Object.assign(wrapped, { data: { status: 404 } });
		expect(refusalOf(wrapped)).toBe(refusal);
		expect(refusalOf(httpError(401)).code).toBe('MOUNT_UNAUTHORIZED');
	});

	it('P6-E5: through the real SDK, a relay refusal of the connection arrives as its code', async () => {
		vi.stubGlobal('fetch', async () => marked(403, { code: 'MOUNT_PROJECT_NOT_LISTED' }));
		await expect(
			createMountTransport('https://shell.test/mounts/work/mcp').connect()
		).rejects.toMatchObject({
			code: 'MOUNT_PROJECT_NOT_LISTED',
		});
	});

	it('P6-E5: a relay 401 `UNAUTHORIZED` runs the session refresh; the same body without the header is MOUNT_UNAUTHORIZED, with no refresh', async () => {
		const refreshSession = vi.fn();
		vi.stubGlobal('fetch', async () => marked(401, { code: 'UNAUTHORIZED' }));
		await expect(
			createMountTransport('https://shell.test/mounts/work/mcp', undefined, {
				refreshSession,
			}).connect()
		).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		expect(refreshSession).toHaveBeenCalledOnce();
		vi.stubGlobal('fetch', async () => marked(401, { code: 'AGENT_CANNOT_SIGN_IN' }));
		await expect(
			createMountTransport('https://shell.test/mounts/work/mcp', undefined, {
				refreshSession,
			}).connect()
		).rejects.toMatchObject({ code: 'AGENT_CANNOT_SIGN_IN' });
		expect(refreshSession).toHaveBeenCalledTimes(2);
		vi.stubGlobal('fetch', async () => marked(401, { code: 'UNAUTHORIZED' }, false));
		await expect(
			createMountTransport('https://shell.test/mounts/work/mcp', undefined, {
				refreshSession,
			}).connect()
		).rejects.toMatchObject({ code: 'MOUNT_UNAUTHORIZED' });
		expect(refreshSession).toHaveBeenCalledTimes(2);
	});

	it('P6-E5: MOUNT_SESSION_UNKNOWN closes the transport, and `request` connects again before its next send', async () => {
		let connects = 0;
		let sends = 0;
		const { seen, Fake } = fakeTransport({
			connect: async () => {
				connects++;
			},
			send: async () => {
				sends++;
				if (sends === 1)
					throw new Error('Error POSTing', {
						cause: await boundedFetch('u', { method: 'POST' }).catch((error: Error) => error),
					});
				return { result: { structuredContent: { success: true } } };
			},
		});
		vi.stubGlobal('fetch', async () => marked(404, { code: 'MOUNT_SESSION_UNKNOWN' }));
		const port = createMountTransport('u', Fake);
		await port.connect();
		await expect(port.callTool('hello-greet', {})).rejects.toMatchObject({
			code: 'MOUNT_SESSION_UNKNOWN',
		});
		expect(seen.disconnects).toBe(1);
		expect(connects).toBe(1);
		await port.callTool('hello-greet', {});
		expect(connects).toBe(2);
		await port.callTool('hello-greet', {});
		expect(connects).toBe(2);
	});
});

describe("P6-E5: an instance's own `UNAUTHORIZED` in a tool result (8.1's last row)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const MANIFEST = {
		manifest_version: 1,
		protocol: 1,
		plugin: {
			id: 'umbel',
			title: 'Umbel',
			version: '0.1.0',
			description: 'A mounted host, for this test.',
			kind: 'mounted',
			domains: ['umbel'],
		},
		mount: { prefix: 'umbel', transport: 'http' },
	};
	const ENTRY = {
		instance: 'work',
		app: 'umbel',
		package: 'apps/work/',
		prefix: 'work',
		audience: 'person',
		transport: 'http',
		route: 'mounts/work/mcp',
	};

	/** An instance behind the route, answering `200` for each request, as the relay passes an answer back (no mark). */
	function instance(answer: unknown) {
		const methods: string[] = [];
		const json = (id: unknown, result: unknown) =>
			new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		const fetch = async (_url: unknown, init?: RequestInit) => {
			const message = JSON.parse(String(init?.body)) as {
				id?: unknown;
				method: string;
				params?: { name?: string; arguments?: { command?: string[] } };
			};
			methods.push(message.params?.name ?? message.method);
			if (message.id === undefined) return new Response(null, { status: 202 });
			if (message.method === 'initialize')
				return json(message.id, {
					protocolVersion: '2025-11-25',
					capabilities: { tools: {} },
					serverInfo: { name: 'work', version: '1' },
				});
			const tool = message.params?.name;
			if (tool === 'afd-help')
				return json(message.id, {
					structuredContent: {
						success: true,
						data: { toolStrategy: 'hybrid', firstClassTools: [], commands: [{ name: 'a-read' }] },
					},
				});
			if (tool === 'afd-detail')
				return json(message.id, {
					structuredContent: {
						success: true,
						data: [
							{
								name: 'a-read',
								found: true,
								callable: true,
								mutation: false,
								description: 'Reads a',
								inputSchema: { type: 'object', properties: {} },
							},
						],
					},
				});
			return json(message.id, { structuredContent: answer });
		};
		return { methods, fetch };
	}

	it("P6-E5: is returned as the instance's code, labelled untrusted with dev.loam/instance, with no refresh and no close", async () => {
		const { createKernel } = await import('@lushly-dev/loam-kernel');
		const { createFixedEnvironment, createFixturePorts } = await import(
			'@lushly-dev/loam-kernel/testing'
		);
		const { MockAuthAdapter } = await import('@lushly-dev/afd-auth');
		const { MemoryJournalSink } = await import('@lushly-dev/afd-core');
		const { MemoryAdapter } = await import('@lushly-dev/local-db');
		const server = instance({
			success: false,
			error: { code: 'UNAUTHORIZED', message: 'The instance says sign in', suggestion: 'Its own' },
		});
		vi.stubGlobal('fetch', server.fetch);
		const refreshSession = vi.fn();
		const closes: number[] = [];
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			deployment: {
				deployment_version: 2,
				generation: 'test',
				workspace: { id: 'personal', name: 'Personal' },
				sandbox_origin: null,
				apps: [ENTRY],
			} as never,
			ports: {
				...createFixturePorts({ 'apps/work/': { manifest: MANIFEST } } as never),
				async mountTransport() {
					const port = createMountTransport('https://shell.test/mounts/work/mcp', undefined, {
						refreshSession,
					});
					return {
						...port,
						close() {
							closes.push(1);
							return port.close();
						},
					};
				},
			},
		});
		try {
			await kernel.startInstances();
			const connects = () => server.methods.filter((method) => method === 'initialize').length;
			expect(connects()).toBe(1);
			const result = await kernel.call('work-a-read', {});
			// The instance's code, in its own words, as an instance's answer: not the kernel's `UNAUTHORIZED`.
			expect(result.success).toBe(false);
			expect(result.error).toMatchObject({
				code: 'UNAUTHORIZED',
				message: 'The instance says sign in',
			});
			expect(result.metadata).toMatchObject({
				'dev.loam/trust': 'untrusted',
				'dev.loam/instance': 'work',
			});
			// No refresh, and the transport neither closed nor connected again: the next call goes out on it.
			expect(refreshSession).not.toHaveBeenCalled();
			expect(closes).toEqual([]);
			await kernel.call('work-a-read', {});
			expect(connects()).toBe(1);
			expect(
				server.methods.filter((method) => method === 'a-read' || method === 'afd-call')
			).toHaveLength(2);
			expect(refreshSession).not.toHaveBeenCalled();
		} finally {
			await kernel.dispose();
		}
	});
});

describe("P6-E5: a call's event stream that ends without its response fails the call at once (8.1 step 15)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const encoder = new TextEncoder();
	const event = (message: unknown) => `data: ${JSON.stringify(message)}\n\n`;
	const notice = event({ jsonrpc: '2.0', method: 'notifications/progress', params: {} });

	/**
	 * A stream of `parts`, one on each read, then its end, a break, or more bytes than the limit. A break comes on the read
	 * after the last part, so every part has reached the reader first.
	 */
	const streamOf = (parts: string[], end: 'close' | 'break' | 'flood' = 'close') => {
		let next = 0;
		return new ReadableStream<Uint8Array>({
			pull(controller) {
				const part = parts[next++];
				if (part !== undefined) return controller.enqueue(encoder.encode(part));
				if (end === 'close') controller.close();
				else if (end === 'break') controller.error(new TypeError('network error'));
				else controller.enqueue(new Uint8Array(1024 * 1024));
			},
		});
	};
	const sse = (body: ReadableStream<Uint8Array>, status = 200) =>
		new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
	const call = (id: number | string) =>
		JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'x' } });
	const cutOf = (text: string) => JSON.parse(text.trim().slice('data: '.length));

	it("P6-E5: a stream that ends with no response gains one JSON-RPC error for its id; one with its response is unchanged; another id's response never passes", async () => {
		const response = event({ jsonrpc: '2.0', id: 7, result: { content: [] } });
		vi.stubGlobal('fetch', async () => sse(streamOf([notice, response])));
		const whole = await boundedFetch('u', { method: 'POST', body: call(7) });
		expect(await whole.text()).toBe(notice + response);
		// Another id's response is dropped, so it can settle no other call; the stream still ends without this one's.
		const other = event({ jsonrpc: '2.0', id: 8, result: {} });
		vi.stubGlobal('fetch', async () => sse(streamOf([notice, other])));
		const cut = await (await boundedFetch('u', { method: 'POST', body: call(7) })).text();
		expect(cut.startsWith(notice)).toBe(true);
		expect(cutOf(cut.slice(notice.length))).toMatchObject({
			jsonrpc: '2.0',
			id: 7,
			error: { code: -32000 },
		});
		// Any `2xx` stream but a `202`, not only a `200`.
		vi.stubGlobal('fetch', async () => sse(streamOf([notice]), 201));
		const created = await (await boundedFetch('u', { method: 'POST', body: call(7) })).text();
		expect(cutOf(created.slice(notice.length))).toMatchObject({ id: 7 });
		// Only a call's stream: an `initialize` answered on a stream is passed as it came.
		vi.stubGlobal('fetch', async () => sse(streamOf([notice])));
		const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
		expect(await (await boundedFetch('u', { method: 'POST', body })).text()).toBe(notice);
	});

	it('P6-E5: a `\\r`, then a chunk of no bytes, then its `\\n` is one line end: the event is not split, and its response passes', async () => {
		const parts = ['data: {"jsonrpc":"2.0",\r', '', '\ndata: "id":7,"result":{"content":[]}}\n\n'];
		vi.stubGlobal('fetch', async () => sse(streamOf(parts)));
		const text = await (await boundedFetch('u', { method: 'POST', body: call(7) })).text();
		// The two `data` lines are one event (joined by `\n`, JSON whitespace), so no cut is added after it.
		expect(text).toBe('data: {"jsonrpc":"2.0",\ndata: "id":7,"result":{"content":[]}}\n\n');
	});

	it('P6-E5: a line of 4 MiB in 1 KiB pieces is read in time linear in its length', async () => {
		const piece = 'x'.repeat(1024);
		const pieces = ['data: ', ...Array.from({ length: 4 * 1024 - 1 }, () => piece)];
		vi.stubGlobal('fetch', async () => sse(streamOf(pieces)));
		const started = Date.now();
		const text = await (await boundedFetch('u', { method: 'POST', body: call(3) })).text();
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(cutOf(text)).toMatchObject({ id: 3, error: { code: -32000 } });
	});

	/**
	 * The real SDK on a legacy server: `server/discover` refused, `initialize` answered, and each `tools/call` answered
	 * by `answer`, so the call's failure is the SDK's own reading of what the stream gave it.
	 */
	function legacyServer(answer: (id: number | string) => Response | Promise<Response>) {
		return async (_input: unknown, init?: RequestInit) => {
			const message = JSON.parse(String(init?.body ?? '{}')) as { id?: number; method?: string };
			const json = (status: number, value: unknown) =>
				new Response(JSON.stringify(value), {
					status,
					headers: { 'content-type': 'application/json' },
				});
			if (message.method === 'server/discover')
				return json(400, {
					jsonrpc: '2.0',
					id: message.id,
					error: { code: -32601, message: 'Method not found' },
				});
			if (message.method === 'initialize')
				return json(200, {
					jsonrpc: '2.0',
					id: message.id,
					result: {
						protocolVersion: '2025-11-25',
						capabilities: { tools: {} },
						serverInfo: { name: 'legacy', version: '1' },
					},
				});
			if (message.method === 'tools/call') return answer(message.id as number);
			return new Response(null, { status: 202 });
		};
	}

	it.each([
		['ends with no response', 'close', 'MOUNT_UNREACHABLE'],
		['breaks', 'break', 'MOUNT_UNREACHABLE'],
		['passes the limit', 'flood', 'MOUNT_RESULT_INVALID'],
	] as const)(
		'P6-E5: through the real SDK, a stream that %s fails the call at once as %s',
		async (_what, end, code) => {
			vi.stubGlobal(
				'fetch',
				legacyServer(() => sse(streamOf([notice], end)))
			);
			const port = createMountTransport('https://shell.test/mounts/work/mcp');
			await port.connect();
			const started = Date.now();
			await expect(port.callTool('hello-greet', {})).rejects.toMatchObject({ code });
			expect(Date.now() - started).toBeLessThan(2_000);
			await port.close();
		}
	);

	/** The real SDK's call against a stream of `parts` for its id, then `end`: its code, and how long it took. */
	async function callAgainst(
		parts: (id: number | string) => string[],
		end: 'close' | 'break' = 'close'
	) {
		vi.stubGlobal(
			'fetch',
			legacyServer((id) => sse(streamOf(parts(id), end)))
		);
		const port = createMountTransport('https://shell.test/mounts/work/mcp');
		await port.connect();
		const started = Date.now();
		try {
			return await port.callTool('hello-greet', {}).then(
				(result) => ({ result, ms: Date.now() - started }),
				(error: { code?: string }) => ({ code: error.code, ms: Date.now() - started })
			);
		} finally {
			await port.close();
		}
	}

	const answer = (id: number | string) =>
		`data: ${JSON.stringify({ jsonrpc: '2.0', id, result: { content: [], structuredContent: { planted: true } } })}`;

	it.each([
		['no blank line', ''],
		['one line ending', '\n'],
		['a `\\r` that may start `\\r\\n`', '\r'],
		['a `\\r\\n`', '\r\n'],
	])(
		'P6-E5: through the real SDK, a response whose event never ended (%s) is no answer: the call fails at once',
		async (_what, tail) => {
			for (const end of ['close', 'break'] as const) {
				const answered = await callAgainst((id) => [notice, `${answer(id)}${tail}`], end);
				expect(answered, end).toMatchObject({ code: 'MOUNT_UNREACHABLE' });
				expect(answered.ms, end).toBeLessThan(2_000);
			}
		}
	);

	it.each([
		['`\\n\\n`', '\n\n'],
		['`\\r\\n\\r\\n`', '\r\n\r\n'],
		['`\\r\\r`, the last `\\r` at the end of the stream', '\r\r'],
	])(
		'P6-E5: through the real SDK, a response whose event ends in %s answers the call, the stream then ending',
		async (_what, tail) => {
			for (const end of ['close', 'break'] as const) {
				const answered = await callAgainst((id) => [notice, `${answer(id)}${tail}`], end);
				expect(answered, end).toMatchObject({ result: { structuredContent: { planted: true } } });
			}
		}
	);

	it('P6-E5: through the real SDK, a whole response split across chunks still answers the call', async () => {
		const answered = await callAgainst((id) => {
			const whole = `${answer(id)}\r\n\r\n`;
			return [notice, whole.slice(0, 9), whole.slice(9, -3), whole.slice(-3, -1), whole.slice(-1)];
		});
		expect(answered).toMatchObject({ result: { structuredContent: { planted: true } } });
	});

	it.each([
		['a scalar `result`', (id: number | string) => event({ jsonrpc: '2.0', id, result: 5 })],
		['an array `result`', (id: number | string) => event({ jsonrpc: '2.0', id, result: [] })],
		[
			'a `result._meta` that is no object',
			(id: number | string) => event({ jsonrpc: '2.0', id, result: { content: [], _meta: 5 } }),
		],
		[
			'an `error` with no integer code',
			(id: number | string) => event({ jsonrpc: '2.0', id, error: { code: 'x', message: 'm' } }),
		],
		[
			'an `error.code` past a safe integer',
			(id: number | string) =>
				`data: {"jsonrpc":"2.0","id":${JSON.stringify(id)},"error":{"code":1e300,"message":"m"}}\n\n`,
		],
		[
			'both `result` and `error`',
			(id: number | string) =>
				event({ jsonrpc: '2.0', id, result: {}, error: { code: 1, message: 'm' } }),
		],
		[
			'a `method` beside its `result`',
			(id: number | string) => event({ jsonrpc: '2.0', id, method: 'x', result: { content: [] } }),
		],
		[
			'a key outside the envelope',
			(id: number | string) => event({ jsonrpc: '2.0', id, result: { content: [] }, extra: 1 }),
		],
		['no `jsonrpc`', (id: number | string) => event({ id, result: { content: [] } })],
		[
			'an event of another type',
			(id: number | string) =>
				`event: other\n${event({ jsonrpc: '2.0', id, result: { content: [] } })}`,
		],
	])(
		'P6-E5: through the real SDK, a response the SDK rejects (%s) fails the call at once, not at its deadline',
		async (_what, response) => {
			const answered = await callAgainst((id) => [notice, response(id)]);
			expect(answered).toMatchObject({
				code: 'MOUNT_UNREACHABLE',
			});
			expect(answered.ms).toBeLessThan(2_000);
		}
	);

	it("P6-E5: through the real SDK, two calls at once each settle with their own answer: one stream's response to the other's id never reaches it", async () => {
		let calls = 0;
		let second: (() => void) | undefined;
		const secondArrived = new Promise<void>((done) => {
			second = done;
		});
		vi.stubGlobal(
			'fetch',
			legacyServer(async (id) => {
				calls++;
				if (calls === 2) {
					second?.();
					// Answered later than the first stream's planted answer for it.
					return sse(
						new ReadableStream<Uint8Array>({
							async pull(controller) {
								await new Promise((done) => setTimeout(done, 100));
								controller.enqueue(
									encoder.encode(
										event({
											jsonrpc: '2.0',
											id,
											result: { content: [], structuredContent: { own: 2 } },
										})
									)
								);
								controller.close();
							},
						})
					);
				}
				// The first call's stream answers the second call's id first, once that call is pending, then its own.
				await secondArrived;
				const other = typeof id === 'number' ? id + 1 : id;
				return sse(
					streamOf([
						event({
							jsonrpc: '2.0',
							id: other,
							result: { content: [], structuredContent: { planted: true } },
						}),
						event({ jsonrpc: '2.0', id, result: { content: [], structuredContent: { own: 1 } } }),
					])
				);
			})
		);
		const port = createMountTransport('https://shell.test/mounts/work/mcp');
		await port.connect();
		try {
			const [first, next] = await Promise.all([
				port.callTool('hello-greet', {}),
				port.callTool('hello-greet', {}),
			]);
			expect(first).toMatchObject({ structuredContent: { own: 1 } });
			expect(next).toMatchObject({ structuredContent: { own: 2 } });
		} finally {
			await port.close();
		}
	});

	it("P6-E5: an instance's own JSON-RPC error naming the mark is MOUNT_RESULT_INVALID: no instance chooses the code", async () => {
		vi.stubGlobal(
			'fetch',
			legacyServer((id) =>
				sse(
					streamOf([
						event({
							jsonrpc: '2.0',
							id,
							error: { code: -32000, message: 'x', data: { 'dev.loam/cut': 'guessed' } },
						}),
					])
				)
			)
		);
		const port = createMountTransport('https://shell.test/mounts/work/mcp');
		await port.connect();
		await expect(port.callTool('hello-greet', {})).rejects.toMatchObject({
			code: 'MOUNT_RESULT_INVALID',
		});
		await port.close();
	});
});

describe('P5-B3: MountTransportV3 on the http lane (phase 5 specification, 9.3)', () => {
	it('P5-B3: lists and reads ui:// resources, and refuses with the lane when it refuses them', async () => {
		const sent: Array<{ method?: string; params?: unknown }> = [];
		const { Fake } = fakeTransport({
			send: async (request: { method?: string; params?: unknown }) => {
				sent.push(request);
				return request.method === 'resources/list'
					? {
							result: {
								resources: [{ uri: 'ui://mail/thread', mimeType: 'text/html' }, { uri: 7 }],
							},
						}
					: { result: { contents: [{ uri: 'ui://mail/thread', text: '<p>hi</p>' }] } };
			},
		});
		const transport = createMountTransport('u', Fake);
		expect(await transport.listResources?.()).toEqual([
			{ uri: 'ui://mail/thread', mimeType: 'text/html' },
		]);
		expect(await transport.readResource?.('ui://mail/thread')).toEqual({
			contents: [{ uri: 'ui://mail/thread', text: '<p>hi</p>' }],
		});
		expect(sent.map((request) => request.method)).toEqual(['resources/list', 'resources/read']);
		const { Fake: Refusing } = fakeTransport({
			send: async () => ({ error: { code: -32601, message: 'refused' } }),
		});
		await expect(createMountTransport('u', Refusing).listResources?.()).rejects.toBeDefined();
	});
});
