import { afterEach, describe, expect, it } from 'vitest';
import {
	createDesktopMountTransport,
	DESKTOP_MODERN_VERSION,
	DESKTOP_PROTOCOL_VERSION,
} from './mount-desktop.js';
import { webPorts } from './ports.js';

type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;
const held = globalThis as { __TAURI_INTERNALS__?: { invoke: Invoke } };

/** A fake Rust host: each call recorded, each `mount_send` answered by `answer`. */
function fakeHost(answer: (message: { id?: number; method: string }) => unknown) {
	const calls: { command: string; args: Record<string, unknown> }[] = [];
	held.__TAURI_INTERNALS__ = {
		async invoke(command, args) {
			calls.push({ command, args });
			if (command === 'mount_open') return 7;
			if (command === 'mount_close') return null;
			return answer(args.message as { id?: number; method: string });
		},
	};
	return calls;
}

const respond = (message: { id?: number; method: string }, result: unknown) =>
	message.id === undefined ? null : { jsonrpc: '2.0', id: message.id, result };

afterEach(() => {
	delete held.__TAURI_INTERNALS__;
});

describe('DesktopMountTransport (phase 6 specification, 10.4)', () => {
	it('P6-D2: names the instance alone, shakes hands, and carries the scope in _meta untouched', async () => {
		const calls = fakeHost((message) =>
			message.method === 'initialize'
				? respond(message, { protocolVersion: '2025-06-18', capabilities: {} })
				: message.method === 'tools/list'
					? respond(message, { tools: [{ name: 'hello-greet', inputSchema: {} }] })
					: respond(message, { content: [], structuredContent: { success: true } })
		);
		const transport = createDesktopMountTransport('home');
		expect(await transport.connect()).toEqual({ protocolVersion: '2025-06-18' });
		expect(await transport.listTools()).toEqual([{ name: 'hello-greet', inputSchema: {} }]);
		await transport.callTool('hello-greet', { name: 'Ada' }, undefined, {
			'dev.loam/scope': { workspace: 'personal' },
		});
		await transport.close();
		expect(calls.map(({ command }) => command)).toEqual([
			'mount_open',
			'mount_send',
			'mount_send',
			'mount_send',
			'mount_send',
			'mount_close',
		]);
		expect(calls[0]?.args).toEqual({ instance: 'home' });
		expect(calls[1]?.args.message).toMatchObject({
			method: 'initialize',
			params: { protocolVersion: DESKTOP_PROTOCOL_VERSION },
		});
		expect(calls[2]?.args.message).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized' });
		expect(calls[4]?.args).toEqual({
			handle: 7,
			message: {
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/call',
				params: {
					name: 'hello-greet',
					arguments: { name: 'Ada' },
					_meta: { 'dev.loam/scope': { workspace: 'personal' } },
				},
			},
		});
		expect(calls[5]?.args).toEqual({ handle: 7 });
	});

	it("maps the host's codes to the kernel's, and a server's error or a wrong id to MOUNT_RESULT_INVALID", async () => {
		held.__TAURI_INTERNALS__ = { invoke: () => Promise.reject('INSTANCE_UNKNOWN') };
		await expect(createDesktopMountTransport('x').connect()).rejects.toMatchObject({
			code: 'MOUNT_UNREACHABLE',
		});
		held.__TAURI_INTERNALS__ = {
			invoke: (command) =>
				command === 'mount_open' ? Promise.resolve(1) : Promise.reject('MOUNT_UNAUTHORIZED'),
		};
		await expect(createDesktopMountTransport('x').connect()).rejects.toMatchObject({
			code: 'MOUNT_UNAUTHORIZED',
		});
		held.__TAURI_INTERNALS__ = { invoke: () => Promise.reject('MOUNT_KEYCHAIN_MISSING') };
		await expect(createDesktopMountTransport('x').connect()).rejects.toMatchObject({
			code: 'MOUNT_KEYCHAIN_MISSING',
		});
		fakeHost((message) =>
			message.method === 'initialize'
				? respond(message, { protocolVersion: '2025-06-18' })
				: { jsonrpc: '2.0', id: message.id, error: { code: -1, message: 'a server <b>says</b>' } }
		);
		const transport = createDesktopMountTransport('x');
		await transport.connect();
		const refused = await transport.listTools().catch((error: Error) => error);
		expect(refused).toMatchObject({
			code: 'MOUNT_RESULT_INVALID',
			message: 'MOUNT_RESULT_INVALID',
		});
		fakeHost(() => ({ jsonrpc: '2.0', id: 999, result: { protocolVersion: '1' } }) as never);
		await expect(createDesktopMountTransport('x').connect()).rejects.toMatchObject({
			code: 'MOUNT_RESULT_INVALID',
		});
	});

	it('refuses with no IPC in the frame, and when the handshake names no version', async () => {
		await expect(createDesktopMountTransport('x').connect()).rejects.toMatchObject({
			code: 'MOUNT_UNREACHABLE',
		});
		fakeHost((message) => respond(message, {}));
		await expect(createDesktopMountTransport('x').connect()).rejects.toMatchObject({
			code: 'MOUNT_UNREACHABLE',
		});
	});

	it('closes a late mount_open handle when connect aborts first, so subsequent opens do not leak handles', async () => {
		let resolveOpen!: (handle: number) => void;
		const closed: number[] = [];
		let openCalls = 0;
		held.__TAURI_INTERNALS__ = {
			invoke(command, args) {
				if (command === 'mount_open') {
					openCalls++;
					if (openCalls === 1) {
						return new Promise<number>((resolve) => {
							resolveOpen = resolve;
						});
					}
					return Promise.resolve(9);
				}
				if (command === 'mount_close') {
					closed.push(args.handle as number);
					return Promise.resolve(null);
				}
				const message = args.message as { id?: number; method: string };
				return Promise.resolve(respond(message, { protocolVersion: '2025-06-18' }));
			},
		};
		const controller = new AbortController();
		const transport = createDesktopMountTransport('mail');
		const pending = transport.connect(controller.signal);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ code: 'MOUNT_UNREACHABLE' });
		resolveOpen(7);
		await Promise.resolve();
		await Promise.resolve();
		expect(closed).toEqual([7]);
		// Subsequent open succeeds cleanly.
		await expect(createDesktopMountTransport('mail').connect()).resolves.toEqual({
			protocolVersion: '2025-06-18',
		});
	});

	it("is the desktop's port, and the browser's stays the web host's", async () => {
		const made: string[] = [];
		const chunk = {
			createMountTransport(url: string) {
				made.push(`web ${url}`);
				return {} as never;
			},
			createDesktopMountTransport(instance: string) {
				made.push(`desktop ${instance}`);
				return {} as never;
			},
		};
		const entry = { instance: 'home' } as never;
		const load = () => Promise.resolve(chunk);
		const view = () => Promise.reject(new Error('no view'));
		await webPorts({} as Document, 'http://loam.localhost/', null, view, load, true).mountTransport(
			entry,
			'http://loam.localhost/mounts/home/mcp'
		);
		await webPorts({} as Document, 'https://x.example/', null, view, load).mountTransport(
			entry,
			'https://x.example/mounts/home/mcp'
		);
		expect(made).toEqual(['desktop home', 'web https://x.example/mounts/home/mcp']);
	});

	it('opens an approvals = "shell" instance on MCP 2026-07-28, its keys on every request beside the kernel\'s (phase 5, 7.2)', async () => {
		const calls = fakeHost((message) =>
			message.method === 'server/discover'
				? respond(message, { supportedVersions: [DESKTOP_MODERN_VERSION] })
				: respond(message, { content: [], structuredContent: { success: true } })
		);
		const transport = createDesktopMountTransport('mail', { era: 'modern' });
		expect(await transport.connect()).toEqual({
			protocolVersion: DESKTOP_MODERN_VERSION,
			approvals: true,
		});
		await transport.callTool('mail-send', { draft: 'd' }, undefined, {
			'dev.loam/scope': { workspace: 'personal' },
			'dev.afd/approval': 'afdap1.t',
		});
		const sent = calls
			.filter(({ command }) => command === 'mount_send')
			.map(
				({ args }) =>
					args.message as { method: string; params: { _meta?: Record<string, unknown> } }
			);
		// No `initialize`: the modern era opens with discovery, and every request says its era.
		expect(sent.map((message) => message.method)).toEqual(['server/discover', 'tools/call']);
		for (const message of sent) {
			expect(message.params._meta).toMatchObject({
				'io.modelcontextprotocol/protocolVersion': DESKTOP_MODERN_VERSION,
				'io.modelcontextprotocol/clientInfo': { name: 'loam', version: '1' },
			});
		}
		expect(sent[1]?.params._meta).toMatchObject({
			'dev.loam/scope': { workspace: 'personal' },
			'dev.afd/approval': 'afdap1.t',
		});
	});

	it('opens one that does not speak 2026-07-28 with the 2025 handshake, on the same connection', async () => {
		const calls = fakeHost((message) =>
			message.method === 'server/discover'
				? { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'no' } }
				: message.method === 'initialize'
					? respond(message, { protocolVersion: '2025-06-18', capabilities: {} })
					: respond(message, { content: [], structuredContent: { success: true } })
		);
		const transport = createDesktopMountTransport('mail', { era: 'modern' });
		expect(await transport.connect()).toEqual({ protocolVersion: '2025-06-18' });
		await transport.callTool('mail-read', {});
		const sent = calls
			.filter(({ command }) => command === 'mount_send')
			.map(({ args }) => args.message as { method: string; params?: { _meta?: unknown } });
		expect(sent.map((message) => message.method)).toEqual([
			'server/discover',
			'initialize',
			'notifications/initialized',
			'tools/call',
		]);
		expect(sent[3]?.params?._meta).toBeUndefined();
		expect(calls.filter(({ command }) => command === 'mount_open')).toHaveLength(1);
	});

	it('asks the modern era only of an approvals = "shell" instance, over stdio or http (#2137)', async () => {
		const made: unknown[] = [];
		const chunk = {
			createMountTransport: () => ({}) as never,
			createDesktopMountTransport(instance: string, options?: unknown) {
				made.push([instance, options]);
				return {} as never;
			},
		};
		const ports = webPorts(
			{} as Document,
			'http://loam.localhost/',
			null,
			() => Promise.reject(new Error('no view')),
			() => Promise.resolve(chunk),
			true
		);
		for (const entry of [
			{ instance: 'a', approvals: 'shell', transport: 'stdio' },
			{ instance: 'b', approvals: 'shell', transport: 'http' },
			{ instance: 'c', approvals: 'none', transport: 'stdio' },
			{ instance: 'd', transport: 'stdio' },
		])
			await ports.mountTransport(entry as never, 'http://loam.localhost/mounts/x/mcp');
		expect(made).toEqual([
			['a', { era: 'modern' }],
			['b', { era: 'modern' }],
			['c', {}],
			['d', {}],
		]);
	});
});

describe('P5-B3: MountTransportV3 on the desktop lane (phase 5 specification, 9.3)', () => {
	it('P5-B3: lists and reads ui:// resources through mount_send, keeping only well-formed rows', async () => {
		const calls = fakeHost((message) =>
			message.method === 'initialize'
				? respond(message, { protocolVersion: '2025-06-18', capabilities: {} })
				: message.method === 'resources/list'
					? respond(message, {
							resources: [{ uri: 'ui://mail/thread', mimeType: 'text/html' }, { name: 'no uri' }],
						})
					: respond(message, {
							contents: [{ uri: 'ui://mail/thread', mimeType: 'text/html', text: '<p>hi</p>' }],
						})
		);
		const transport = createDesktopMountTransport('mail');
		await transport.connect();
		expect(await transport.listResources?.()).toEqual([
			{ uri: 'ui://mail/thread', mimeType: 'text/html' },
		]);
		expect(await transport.readResource?.('ui://mail/thread')).toEqual({
			contents: [{ uri: 'ui://mail/thread', mimeType: 'text/html', text: '<p>hi</p>' }],
		});
		const sent = calls.flatMap(({ args }) => (args.message ? [args.message] : []));
		expect(sent.at(-1)).toMatchObject({
			method: 'resources/read',
			params: { uri: 'ui://mail/thread' },
		});
	});
});
