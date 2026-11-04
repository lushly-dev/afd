import type { StreamableHttpTransportOptions } from '@lushly-dev/afd-client/streamable-http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedFetch, createMountTransport, RESPONSE_MAX_BYTES } from './mount.js';

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

	it("P2-E6 (unit): puts a command call's meta in `_meta`, and sends none without it (9.2)", async () => {
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
