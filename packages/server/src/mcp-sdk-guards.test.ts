/**
 * @fileoverview Guard tests for the MCP TypeScript SDK internals that `@lushly-dev/afd-server`
 * patches or duck-types (#1744):
 *
 * 1. Dependency ranges in `packages/server/package.json` stay pinned to a tilde range or exact
 *    version so consumers cannot pull a later 2.x minor without re-verifying these guards.
 * 2. `refuseApprovalKeyBeforeParsing` (`mcp-modern.ts`) patches `server.connect` and
 *    `transport.onmessage` to refuse `dev.afd/approval` inside `tools/call` arguments (including
 *    under `__proto__`) before the SDK parses and drops `__proto__`.
 * 3. `contextFields` discovery (`mcp-modern.ts`) wraps `server._ondiscover()` to add
 *    `_meta["dev.afd/contextFields"]` to `server/discover`.
 * 4. `replayed(req)` (`mcp-modern.ts`) hands `@modelcontextprotocol/node`'s `toNodeHandler` a
 *    minimal duck-typed request `{ method, url, headers, [Symbol.asyncIterator]() }` when the body
 *    was preread before routing.
 * 5. `patchToolsCallForTasks` (`tasks-runtime.ts`) wraps `server._wrapHandler` so a
 *    `CreateTaskSignal` thrown from `tools/call` bypasses `CallToolResultSchema` validation.
 *
 * Each guard asserts with a diagnostic naming the patched seam so an SDK upgrade fails loudly.
 */

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { success } from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toNodeHandler, toWebRequest } from '@modelcontextprotocol/node';
import {
	createMcpHandler as createSdkMcpHandler,
	InMemoryTransport,
	Server,
	type Transport,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AFD_APPROVAL_META_KEY } from './approver.js';
import { AFD_CONTEXT_FIELDS_META_KEY, type ContextField } from './context-fields.js';
import { createExecutionEngine } from './execution.js';
import { setPrereadBody } from './http-security.js';
import {
	createModernHttpLane,
	defaultInstructions,
	MODERN_PROTOCOL_VERSION,
	refuseApprovalKeyBeforeParsing,
	replayed,
	serveModernStdio,
	wrapServerDiscover,
} from './mcp-modern.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import {
	CreateTaskSignal,
	patchToolsCallForTasks,
	type WireCreateTaskResult,
} from './tasks-runtime.js';
import { createToolRouter } from './tool-router.js';
import { getToolsList } from './tools.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** Tilde range (`~1.2.3`) or exact semver (`1.2.3`), never a caret (`^`) or wildcard. */
const PINNED_RANGE_RE = /^~?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

describe('MCP SDK dependency pin guard (#1744)', () => {
	it('pins @modelcontextprotocol/server, /node and /client to tilde ranges or exact versions', () => {
		const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};

		const checks: Array<[string, string | undefined]> = [
			[
				'dependencies["@modelcontextprotocol/server"]',
				manifest.dependencies?.['@modelcontextprotocol/server'],
			],
			[
				'dependencies["@modelcontextprotocol/node"]',
				manifest.dependencies?.['@modelcontextprotocol/node'],
			],
			[
				'devDependencies["@modelcontextprotocol/client"]',
				manifest.devDependencies?.['@modelcontextprotocol/client'],
			],
		];

		for (const [label, range] of checks) {
			expect(range, `${label} is missing from packages/server/package.json (#1744)`).toBeDefined();
			expect(
				PINNED_RANGE_RE.test(range ?? ''),
				`${label} is "${range}": afd-server patches private MCP SDK internals (_ondiscover, _wrapHandler, connect/onmessage, replayed request shape for toNodeHandler) and must use a tilde range (~x.y.z) or exact version, widened deliberately after running mcp-sdk-guards.test.ts (#1744)`
			).toBe(true);
		}
	});
});

describe('MCP SDK Server.connect / transport.onmessage pre-parse guard (#1744)', () => {
	it('Server.connect installs transport.onmessage before resolving, and fails loudly when absent', async () => {
		const server = new Server(
			{ name: 'sdk-guard', version: '0.0.1' },
			{ capabilities: { tools: {} } }
		);
		expect(
			typeof server.connect,
			'MCP SDK Server.connect is no longer a function; refuseApprovalKeyBeforeParsing depends on wrapping it (#1744)'
		).toBe('function');

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		expect(serverTransport.onmessage).toBeUndefined();
		await server.connect(serverTransport);
		cleanups.push(async () => {
			await clientTransport.close();
			await serverTransport.close();
		});

		expect(
			typeof serverTransport.onmessage,
			'MCP SDK Server.connect did not assign transport.onmessage before resolving; refuseApprovalKeyBeforeParsing cannot intercept pre-parse messages (#1744)'
		).toBe('function');

		// Fail-loud checks: missing Server.connect or missing transport.onmessage after connect().
		expect(() => refuseApprovalKeyBeforeParsing({} as unknown as Server, true, () => {})).toThrow(
			/Server\.connect is missing/
		);
		const fakeServer = { connect: async () => {} } as unknown as Server;
		refuseApprovalKeyBeforeParsing(fakeServer, true, () => {});
		await expect(
			fakeServer.connect({ send: async () => {} } as unknown as Transport)
		).rejects.toThrow(/Server\.connect did not install transport\.onmessage/);
	});

	it('intercepts tools/call arguments carrying dev.afd/approval under __proto__ before SDK parsing on both eras (stdio)', async () => {
		const calls: unknown[] = [];
		const ping = defineCommand({
			name: 'guard-ping',
			description: 'Record calls',
			expose: { mcp: true },
			input: z.object({ id: z.number().optional() }),
			handler: async (input) => {
				calls.push(input);
				return success({ ok: true });
			},
		});
		const all = [ping];
		const engine = createExecutionEngine({
			commandMap: new Map([[ping.name, ping]]),
			middleware: [],
			devMode: false,
		});
		const routeToolCall = createToolRouter({
			executeCommand: engine.executeCommand,
			executeBatch: engine.executeBatch,
			executePipeline: engine.executePipeline,
			commands: all,
			toolStrategy: 'individual',
			devMode: false,
			allCommands: all,
			exposedCommandNames: new Set([ping.name]),
		});

		for (const era of ['modern', 'legacy'] as const) {
			const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
			const handle = serveModernStdio(
				{
					name: 'guard-stdio',
					version: '0.0.1',
					instructions: defaultInstructions({ name: 'guard-stdio', toolStrategy: 'individual' }),
					getToolsList: () => getToolsList(all, 'individual'),
					routeToolCall,
					devMode: false,
				},
				undefined,
				serverSide
			);
			const received: Array<Record<string, unknown>> = [];
			clientSide.onmessage = (msg) => {
				received.push(msg as Record<string, unknown>);
			};
			await clientSide.start();
			cleanups.push(async () => {
				await clientSide.close();
				await handle.close();
			});

			const args = JSON.parse(`{"id":1,"__proto__":{"${AFD_APPROVAL_META_KEY}":"forged"}}`);
			if (era === 'legacy') {
				await clientSide.send({
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
					params: {
						protocolVersion: '2025-11-25',
						capabilities: {},
						clientInfo: { name: 'guard-client', version: '0' },
					},
				} as never);
				await clientSide.send({
					jsonrpc: '2.0',
					method: 'notifications/initialized',
				} as never);
				await clientSide.send({
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/call',
					params: { name: 'guard-ping', arguments: args },
				} as never);
			} else {
				await clientSide.send({
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/call',
					params: {
						name: 'guard-ping',
						arguments: args,
						_meta: {
							'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
							'io.modelcontextprotocol/clientCapabilities': {},
							'io.modelcontextprotocol/clientInfo': { name: 'guard-client', version: '0' },
						},
					},
				} as never);
			}

			// Wait for response id: 2
			const deadline = Date.now() + 2_000;
			let response: Record<string, unknown> | undefined;
			while (Date.now() < deadline) {
				response = received.find((msg) => msg.id === 2);
				if (response) break;
				await new Promise((r) => setTimeout(r, 10));
			}

			expect(
				response,
				`Expected pre-parse refusal response on ${era} stdio; SDK connect/onmessage seam may have changed (#1744)`
			).toBeDefined();
			const result = response?.result as {
				isError?: boolean;
				resultType?: string;
				content?: Array<{ text?: string }>;
			};
			expect(result?.isError).toBe(true);
			if (era === 'modern') {
				expect(result?.resultType).toBe('complete');
			}
			const body = JSON.parse(result?.content?.[0]?.text ?? '{}') as {
				error?: { code?: string };
			};
			expect(
				body.error?.code,
				`Expected VALIDATION_ERROR from pre-parse refusal on ${era} stdio; if the handler ran or the key vanished, the SDK stopped calling transport.onmessage before parsing (#1744)`
			).toBe('VALIDATION_ERROR');
		}

		expect(calls).toEqual([]);
	});

	it('intercepts tools/call carrying dev.afd/approval under __proto__ over Streamable HTTP /mcp (modern and legacy)', async () => {
		const calls: unknown[] = [];
		const ping = defineCommand({
			name: 'http-guard-ping',
			description: 'Record calls',
			expose: { mcp: true },
			input: z.object({ id: z.number().optional() }),
			handler: async (input) => {
				calls.push(input);
				return success({ ok: true });
			},
		});
		const handler = createMcpHandler({
			name: 'http-guard',
			version: '0.0.1',
			commands: [ping],
			host: '127.0.0.1',
			toolStrategy: 'individual',
		});
		const httpServer = createServer(handler);
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
		cleanups.push(async () => {
			handler.dispose();
			httpServer.closeAllConnections();
			await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		});
		const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;

		const rawModern =
			`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"http-guard-ping","arguments":{"id":1,"__proto__":{"${AFD_APPROVAL_META_KEY}":"forged"}},` +
			`"_meta":{"io.modelcontextprotocol/protocolVersion":"${MODERN_PROTOCOL_VERSION}","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"guard","version":"0"}}}}`;
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
				'Mcp-Method': 'tools/call',
				'Mcp-Name': 'http-guard-ping',
			},
			body: rawModern,
		});
		expect(res.status).toBe(200);
		const payload = (await res.json()) as {
			result?: { isError?: boolean; resultType?: string; content?: Array<{ text?: string }> };
		};
		expect(payload.result?.isError).toBe(true);
		expect(payload.result?.resultType).toBe('complete');
		const cmdResult = JSON.parse(payload.result?.content?.[0]?.text ?? '{}') as {
			error?: { code?: string };
		};
		expect(
			cmdResult.error?.code,
			'Expected pre-parse VALIDATION_ERROR on modern HTTP /mcp (#1744)'
		).toBe('VALIDATION_ERROR');

		// Legacy (2025-11-25) HTTP /mcp: initialize, then tools/call with __proto__ payload.
		const legacyInit = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 10,
				method: 'initialize',
				params: {
					protocolVersion: '2025-11-25',
					capabilities: {},
					clientInfo: { name: 'guard-legacy', version: '0' },
				},
			}),
		});
		expect(legacyInit.status).toBe(200);
		const rawLegacy = `{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"http-guard-ping","arguments":{"id":1,"__proto__":{"${AFD_APPROVAL_META_KEY}":"forged"}}}}`;
		const legacyRes = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				'MCP-Protocol-Version': '2025-11-25',
			},
			body: rawLegacy,
		});
		expect(legacyRes.status).toBe(200);
		const legacyText = await legacyRes.text();
		const legacyDataLine = /^data: (.*)$/m.exec(legacyText)?.[1];
		const legacyPayload = JSON.parse(legacyDataLine ?? legacyText) as {
			result?: { isError?: boolean; content?: Array<{ text?: string }> };
		};
		expect(legacyPayload.result?.isError).toBe(true);
		const legacyCmdResult = JSON.parse(legacyPayload.result?.content?.[0]?.text ?? '{}') as {
			error?: { code?: string };
		};
		expect(
			legacyCmdResult.error?.code,
			'Expected pre-parse VALIDATION_ERROR on legacy HTTP /mcp (#1744)'
		).toBe('VALIDATION_ERROR');
		expect(calls).toEqual([]);
	});
});

describe('MCP SDK Server._ondiscover guard (#1744)', () => {
	it('Server exposes _ondiscover() and routes server/discover through it with _meta preserved', async () => {
		const rawServer = new Server(
			{ name: 'discover-guard', version: '0.0.1' },
			{ capabilities: { tools: {} } }
		) as unknown as { _ondiscover?: () => Record<string, unknown> };
		expect(
			typeof rawServer._ondiscover,
			'@modelcontextprotocol/server Server._ondiscover is missing or renamed; contextFields discovery in mcp-modern.ts depends on wrapping it (#1744)'
		).toBe('function');
		const baseline = rawServer._ondiscover?.();
		expect(
			baseline && typeof baseline === 'object' && !Array.isArray(baseline),
			'Server._ondiscover() no longer returns a plain object (#1744)'
		).toBe(true);

		const fields: ContextField[] = [
			{ name: 'workspace', meta: 'dev.example/workspace', schema: z.string() },
		];
		const handler = createMcpHandler({
			name: 'discover-fields-guard',
			version: '0.0.1',
			commands: [
				defineCommand({
					name: 'echo-noop',
					description: 'No-op',
					expose: { mcp: true },
					input: z.object({}),
					handler: async () => success({}),
				}),
			],
			host: '127.0.0.1',
			toolStrategy: 'individual',
			contextFields: fields,
		});
		const httpServer = createServer(handler);
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
		cleanups.push(async () => {
			handler.dispose();
			httpServer.closeAllConnections();
			await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		});

		const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
				'Mcp-Method': 'server/discover',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'server/discover',
				params: {
					_meta: {
						'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
						'io.modelcontextprotocol/clientCapabilities': {},
						'io.modelcontextprotocol/clientInfo': { name: 'guard', version: '0' },
					},
				},
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			result?: { _meta?: Record<string, unknown> };
		};
		expect(
			body.result?._meta?.[AFD_CONTEXT_FIELDS_META_KEY],
			`server/discover did not return _meta["${AFD_CONTEXT_FIELDS_META_KEY}"]; the SDK may have stopped calling Server._ondiscover() or stripped _meta (#1744)`
		).toEqual([
			expect.objectContaining({
				name: 'workspace',
				meta: 'dev.example/workspace',
			}),
		]);
	});

	it('fails loudly when Server._ondiscover is missing', () => {
		expect(() => wrapServerDiscover({} as unknown as Server, [])).toThrow(
			/Server\._ondiscover is missing/
		);
	});
});

describe('MCP SDK toNodeHandler / replayed(req) request shape guard (#1744)', () => {
	const ALLOWED_REPLAYED_PROPS = new Set<string | symbol>([
		'method',
		'url',
		'headers',
		'auth',
		Symbol.asyncIterator,
	]);

	function strictProxy<T extends object>(target: T): T {
		const check = (prop: string | symbol) => {
			if (!ALLOWED_REPLAYED_PROPS.has(prop)) {
				throw new Error(
					`@modelcontextprotocol/node read unexpected property ${String(prop)} on the replayed request object built by mcp-modern.ts replayed(); update replayed() before widening the SDK range (#1744)`
				);
			}
		};
		return new Proxy(target, {
			get(obj, prop, receiver) {
				check(prop);
				const value = Reflect.get(obj, prop, receiver);
				return typeof value === 'function' ? value.bind(obj) : value;
			},
			has(obj, prop) {
				check(prop);
				return Reflect.has(obj, prop);
			},
		});
	}

	function fakeIncomingMessage(
		method: string,
		url: string,
		headers: Record<string, string>,
		body: Buffer
	): IncomingMessage {
		const req = { method, url, headers } as unknown as IncomingMessage;
		setPrereadBody(req, body);
		return req;
	}

	it('toWebRequest and toNodeHandler only read the properties replayed(req) provides and preserve UTF-8 bytes', async () => {
		const payloadObj = {
			jsonrpc: '2.0',
			id: 7,
			method: 'server/discover',
			params: {
				_meta: {
					'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
					'io.modelcontextprotocol/clientCapabilities': {},
					'io.modelcontextprotocol/clientInfo': { name: 'café-🍅', version: '1.0' },
				},
			},
		};
		const rawBody = Buffer.from(JSON.stringify(payloadObj), 'utf8');
		const headers = {
			host: '127.0.0.1:8080',
			'content-type': 'application/json',
			'content-length': String(rawBody.byteLength),
			accept: 'application/json, text/event-stream',
			'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
			'mcp-method': 'server/discover',
		};

		// 1. Direct toWebRequest check under strict Proxy.
		const replay1 = replayed(fakeIncomingMessage('POST', '/mcp', headers, rawBody));
		const proxy1 = strictProxy(replay1);
		const webReq = await toWebRequest(proxy1 as IncomingMessage, undefined, {
			maxRequestBodySize: 1024 * 1024,
		});
		expect(webReq.method).toBe('POST');
		expect(webReq.url).toBe('http://127.0.0.1:8080/mcp');
		expect(await webReq.text()).toBe(rawBody.toString('utf8'));

		// 2. Full toNodeHandler check under strict Proxy against a real SDK MCP handler.
		// Collect adapter errors because toNodeHandler swallows exceptions thrown from onerror.
		const sdkHandler = createSdkMcpHandler(
			() => new Server({ name: 'replay-guard', version: '0.0.1' }, { capabilities: {} }),
			{ maxRequestBodySize: 1024 * 1024 }
		);
		cleanups.push(() => sdkHandler.close());
		const adapterErrors: Error[] = [];
		const nodeHandler = toNodeHandler(sdkHandler, {
			maxRequestBodySize: 1024 * 1024,
			onerror: (err) => {
				adapterErrors.push(err);
			},
		});

		const replay2 = replayed(fakeIncomingMessage('POST', '/mcp', headers, rawBody));
		const proxy2 = strictProxy(replay2);

		let statusCode = 0;
		const chunks: Buffer[] = [];
		const fakeRes = {
			destroyed: false,
			on: () => fakeRes,
			writeHead(code: number) {
				statusCode = code;
				return fakeRes;
			},
			write(chunk: Uint8Array | string) {
				chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
				return true;
			},
			end() {},
		} as unknown as ServerResponse;

		await nodeHandler(proxy2 as IncomingMessage, fakeRes);
		if (adapterErrors[0]) throw adapterErrors[0];
		expect(
			statusCode,
			'toNodeHandler rejected the replayed request built by replayed(req) (#1744)'
		).toBe(200);
		const responseJson = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
			id?: number;
			result?: {
				supportedVersions?: string[];
				_meta?: { 'io.modelcontextprotocol/serverInfo'?: { name?: string } };
			};
		};
		expect(responseJson.id).toBe(7);
		expect(responseJson.result?.supportedVersions).toContain(MODERN_PROTOCOL_VERSION);
		expect(responseJson.result?._meta?.['io.modelcontextprotocol/serverInfo']?.name).toBe(
			'replay-guard'
		);
	});

	it('toNodeHandler enforces maxRequestBodySize (HTTP 413) on a replayed request', async () => {
		const oversized = Buffer.from(JSON.stringify({ pad: 'x'.repeat(256) }), 'utf8');
		const replay = replayed(
			fakeIncomingMessage(
				'POST',
				'/mcp',
				{
					host: '127.0.0.1:8080',
					'content-type': 'application/json',
					accept: 'application/json',
				},
				oversized
			)
		);
		const proxy = strictProxy(replay);
		const sdkHandler = createSdkMcpHandler(
			() => new Server({ name: 'limit-guard', version: '0.0.1' }, { capabilities: {} }),
			{ maxRequestBodySize: 64 }
		);
		cleanups.push(() => sdkHandler.close());
		const adapterErrors: Error[] = [];
		const nodeHandler = toNodeHandler(sdkHandler, {
			maxRequestBodySize: 64,
			onerror: (err) => {
				adapterErrors.push(err);
			},
		});

		let statusCode = 0;
		const fakeRes = {
			destroyed: false,
			on: () => fakeRes,
			writeHead(code: number) {
				statusCode = code;
				return fakeRes;
			},
			write: () => true,
			end() {},
		} as unknown as ServerResponse;

		await nodeHandler(proxy as IncomingMessage, fakeRes);
		if (adapterErrors[0]) throw adapterErrors[0];
		expect(
			statusCode,
			'toNodeHandler did not enforce maxRequestBodySize on replayed(req) (#1744)'
		).toBe(413);
	});

	it('createModernHttpLane serves a real HTTP IncomingMessage whose body was preread', async () => {
		const echo = defineCommand({
			name: 'replay-echo',
			description: 'Echo text',
			expose: { mcp: true },
			input: z.object({ text: z.string() }),
			handler: async (input) => success({ echoed: input.text }),
		});
		const all = [echo];
		const engine = createExecutionEngine({
			commandMap: new Map([[echo.name, echo]]),
			middleware: [],
			devMode: false,
		});
		const routeToolCall = createToolRouter({
			executeCommand: engine.executeCommand,
			executeBatch: engine.executeBatch,
			executePipeline: engine.executePipeline,
			commands: all,
			toolStrategy: 'individual',
			devMode: false,
			allCommands: all,
			exposedCommandNames: new Set([echo.name]),
		});
		const lane = createModernHttpLane({
			name: 'lane-replay-guard',
			version: '0.0.1',
			instructions: defaultInstructions({ name: 'lane-replay-guard', toolStrategy: 'individual' }),
			getToolsList: () => getToolsList(all, 'individual'),
			routeToolCall,
			devMode: false,
			maxBodyBytes: 1024 * 1024,
		});
		const httpServer = createServer(async (req, res) => {
			// Consume the real stream before handing req to the modern lane, mimicking M6 auth.
			const bufs: Buffer[] = [];
			for await (const chunk of req) bufs.push(Buffer.from(chunk));
			setPrereadBody(req, Buffer.concat(bufs));
			await lane.handle(req, res);
		});
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
		cleanups.push(async () => {
			await lane.close();
			httpServer.closeAllConnections();
			await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		});

		const client = new Client(
			{ name: 'lane-client', version: '0' },
			{ versionNegotiation: { mode: 'auto' } }
		);
		await client.connect(
			new StreamableHTTPClientTransport(
				new URL(`http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`)
			)
		);
		cleanups.push(() => client.close());

		const result = await client.callTool({ name: 'replay-echo', arguments: { text: 'café 🍅' } });
		const content = (result as { content: Array<{ text: string }> }).content;
		expect(JSON.parse(content[0]?.text ?? '{}')).toMatchObject({
			success: true,
			data: { echoed: 'café 🍅' },
		});
	});
});

describe('MCP SDK Server._wrapHandler guard for MCP Tasks (#1744)', () => {
	it('patchToolsCallForTasks wraps _wrapHandler and delivers CreateTaskSignal results through the 2026-07-28 modern codec', async () => {
		const wireTask: WireCreateTaskResult = {
			resultType: 'task',
			taskId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
			status: 'working',
			createdAt: '2026-11-27T00:00:00.000Z',
			lastUpdatedAt: '2026-11-27T00:00:00.000Z',
			ttlMs: 60_000,
			pollIntervalMs: 1_000,
		};

		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const received: Array<Record<string, unknown>> = [];
		clientSide.onmessage = (msg) => {
			received.push(msg as Record<string, unknown>);
		};
		// Serve through serveStdio so the SDK negotiates 2026-07-28 and runs rev2026Codec.encodeResult.
		const handle = serveStdio(
			({ era }) => {
				expect(era).toBe('modern');
				const server = new Server(
					{ name: 'tasks-guard', version: '0.0.1' },
					{ capabilities: { tools: {} } }
				);
				const sdk = server as unknown as { _wrapHandler?: unknown };
				expect(
					typeof sdk._wrapHandler,
					'@modelcontextprotocol/server Server._wrapHandler is missing or renamed; patchToolsCallForTasks in tasks-runtime.ts depends on wrapping it (#1744)'
				).toBe('function');
				patchToolsCallForTasks(server);
				server.setRequestHandler('tools/call', async () => {
					throw new CreateTaskSignal(wireTask);
				});
				return server;
			},
			{ transport: serverSide }
		);
		await clientSide.start();
		cleanups.push(async () => {
			await clientSide.close();
			await handle.close();
		});

		await clientSide.send({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: {
				name: 'long-op',
				arguments: {},
				_meta: {
					'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
					'io.modelcontextprotocol/clientCapabilities': {},
					'io.modelcontextprotocol/clientInfo': { name: 'guard', version: '0' },
				},
			},
		} as never);

		const deadline = Date.now() + 2_000;
		let response: Record<string, unknown> | undefined;
		while (Date.now() < deadline) {
			response = received.find((msg) => msg.id === 1);
			if (response) break;
			await new Promise((r) => setTimeout(r, 10));
		}

		const result = response?.result as
			| (WireCreateTaskResult & {
					_meta?: { 'io.modelcontextprotocol/serverInfo'?: { name?: string } };
			  })
			| undefined;
		expect(
			result,
			'patchToolsCallForTasks did not deliver WireCreateTaskResult through rev2026Codec; Server._wrapHandler or Protocol._onrequest may have changed in the MCP SDK (#1744)'
		).toMatchObject(wireTask);
		// Proves the 2026-07-28 modern codec ran (rev2025Codec does not stamp serverInfo in _meta).
		expect(result?._meta?.['io.modelcontextprotocol/serverInfo']?.name).toBe('tasks-guard');
	});

	it('fails loudly when Server._wrapHandler is missing', () => {
		expect(() => patchToolsCallForTasks({} as unknown as Server)).toThrow(
			/Server\._wrapHandler is missing/
		);
	});
});
