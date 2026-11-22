/**
 * P6-H6's instances (phase 6 specification, 8.1 and section 19): what the hosted relay reaches, each logging every
 * request exactly as it arrived (method, headers, body), so a test reads what the relay sent and nothing the page did.
 *
 * - `startAfdFixture`: a real `createMcpHandler`, stateless, which declares `dev.loam/scope` and answers what its
 *   handlers saw; `hybrid` with one first-class tool, or AFD's default `grouped`, whose group tool routes `action`.
 * - `startLegacyFixture`: a stateful, legacy-only server on the MCP SDK's own Streamable HTTP server transport, which
 *   issues sessions and refuses `server/discover` with a JSON-RPC error, so a client falls back to `initialize`.
 * - Each takes `answer`, a scripted reply for a request a test names, standing in for an instance that misbehaves.
 */

import { randomUUID } from 'node:crypto';
import {
	createServer,
	type IncomingHttpHeaders,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { createMcpHandler, defineCommand } from '@lushly-dev/afd-server';
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';

export interface Logged {
	method: string;
	headers: IncomingHttpHeaders;
	body: string;
	/** The connection closed before the instance answered it whole: the relay aborted it. */
	closedEarly?: boolean;
}

/** A scripted reply: written by the test instead of the fixture's own answer, or `undefined` to let it answer. */
export type Scripted = (
	request: Logged,
	response: ServerResponse
) => boolean | Promise<boolean> | undefined;

export interface Fixture {
	url: string;
	log: Logged[];
	/** The handlers' own record: each command that ran, its scope and its input. */
	ran: Array<{ command: string; scope: unknown; input: unknown }>;
	answer: Scripted | undefined;
	close(): Promise<void>;
}

async function readAll(incoming: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of incoming) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

async function listen(
	handle: (incoming: IncomingMessage, outgoing: ServerResponse, logged: Logged) => Promise<void>,
	fixture: Omit<Fixture, 'url' | 'close'>
): Promise<{ url: string; server: Server }> {
	const server = createServer((incoming, outgoing) => {
		void (async () => {
			const logged: Logged = {
				method: incoming.method ?? 'GET',
				headers: incoming.headers,
				body: await readAll(incoming),
			};
			fixture.log.push(logged);
			outgoing.on('close', () => {
				if (!outgoing.writableFinished) logged.closedEarly = true;
			});
			if (await fixture.answer?.(logged, outgoing)) return;
			await handle(incoming, outgoing, logged);
		})().catch(() => {
			if (!outgoing.headersSent) outgoing.writeHead(500).end();
		});
	});
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, server };
}

const stop = (server: Server) =>
	new Promise<void>((done) => {
		server.closeAllConnections();
		server.close(() => done());
	});

const SCOPE = z.strictObject({
	workspace: z.string().min(1).max(128),
	project: z.string().min(1).max(128).optional(),
});

/** A real AFD server: `hybrid` with `notes-get` first-class, or `grouped`, where `notes { action }` routes. */
export async function startAfdFixture(strategy: 'hybrid' | 'grouped' = 'hybrid'): Promise<Fixture> {
	const fixture: Omit<Fixture, 'url' | 'close'> = { log: [], ran: [], answer: undefined };
	const command = (name: string, mutation = false) =>
		defineCommand({
			name,
			description: name,
			mutation,
			expose: { mcp: true, palette: true, agent: true },
			input: z.object({ space: z.string().optional(), text: z.string().optional() }),
			async handler(input, context) {
				const scope = (context as { scope?: unknown }).scope ?? null;
				fixture.ran.push({ command: name, scope, input });
				return success({ command: name, scope, space: input.space ?? null });
			},
		});
	const handler = createMcpHandler({
		name: `relay-${strategy}-fixture`,
		version: '0.0.0',
		commands: [command('notes-get'), command('notes-list'), command('notes-delete', true)] as never,
		contextFields: [{ name: 'scope', meta: 'dev.loam/scope', schema: SCOPE }],
		host: '127.0.0.1',
		bootstrap: true,
		...(strategy === 'hybrid'
			? { toolStrategy: 'hybrid' as const, firstClassTools: ['notes-get'] }
			: {}),
	});
	const { url, server } = await listen(
		(incoming, outgoing, logged) => handler(incoming, outgoing, logged.body),
		fixture
	);
	return Object.assign(fixture, {
		url,
		async close() {
			handler.dispose();
			await stop(server);
		},
	});
}

/** A CommandResult as an AFD server answers a tool call. */
const result = (value: unknown) => ({
	content: [{ type: 'text' as const, text: JSON.stringify(value) }],
	structuredContent: value as Record<string, unknown>,
});

/**
 * A stateful, legacy-only server on the SDK's Streamable HTTP server transport: one transport per session, `afd-help`
 * and `afd-detail` as AFD answers them, `legacy-echo`, and `legacy-slow`, which answers only when its call is aborted
 * or a test releases it. `server/discover` is refused with a JSON-RPC error, as a server of the legacy era answers it.
 */
export async function startLegacyFixture(): Promise<
	Fixture & { release(): void; openSessions(): string[] }
> {
	const fixture: Omit<Fixture, 'url' | 'close'> = { log: [], ran: [], answer: undefined };
	const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
	/** The client that opened each session, by its `initialize`'s `clientInfo.name`. */
	const owners = new Map<string, string>();
	let releaseSlow: (() => void) | undefined;
	const tools = {
		'legacy-echo': { mutation: false, description: 'Echo' },
		'legacy-slow': { mutation: false, description: 'Slow' },
	};
	function open(): { server: McpServer; transport: WebStandardStreamableHTTPServerTransport } {
		const server = new McpServer({ name: 'relay-legacy-fixture', version: '0.0.0' });
		server.registerTool(
			'afd-help',
			{ inputSchema: z.object({ format: z.string().optional(), filter: z.string().optional() }) },
			async () =>
				result({
					success: true,
					data: {
						toolStrategy: 'individual',
						commands: Object.keys(tools).map((name) => ({ name })),
					},
				})
		);
		server.registerTool(
			'afd-detail',
			{ inputSchema: z.object({ command: z.union([z.string(), z.array(z.string())]) }) },
			async ({ command }) =>
				result({
					success: true,
					data: [command]
						.flat()
						.filter((name) => Object.hasOwn(tools, name))
						.map((name) => ({
							name,
							found: true,
							callable: true,
							...tools[name as keyof typeof tools],
							inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
						})),
				})
		);
		server.registerTool(
			'afd-call',
			{
				inputSchema: z.object({
					command: z.string(),
					input: z.record(z.string(), z.unknown()).optional(),
				}),
			},
			async ({ command, input }) => {
				fixture.ran.push({ command, scope: null, input: input ?? {} });
				// Held until a test releases it, or for at most 10 s: whether the relay aborted it is in `closedEarly`.
				if (command === 'legacy-slow')
					await new Promise<void>((done) => {
						releaseSlow = done;
						setTimeout(done, 10_000).unref();
					});
				return result({ success: true, data: { command, input: input ?? {} } });
			}
		);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			onsessioninitialized: (id) => {
				sessions.set(id, transport);
			},
			onsessionclosed: (id) => {
				sessions.delete(id);
				owners.delete(id);
			},
		});
		return { server, transport };
	}
	const { url, server } = await listen(async (incoming, outgoing, logged) => {
		let parsed: unknown;
		try {
			parsed = logged.body ? JSON.parse(logged.body) : undefined;
		} catch {
			parsed = undefined;
		}
		const method = (parsed as { method?: unknown } | undefined)?.method;
		if (method === 'server/discover') {
			const body = JSON.stringify({
				jsonrpc: '2.0',
				id: (parsed as { id?: unknown }).id ?? null,
				error: { code: -32601, message: 'Method not found' },
			});
			outgoing.writeHead(400, { 'content-type': 'application/json' }).end(body);
			return;
		}
		const id = incoming.headers['mcp-session-id'];
		let transport = typeof id === 'string' ? sessions.get(id) : undefined;
		if (!transport && method === 'initialize') {
			const opened = open();
			await opened.server.connect(opened.transport);
			transport = opened.transport;
		}
		if (!transport) {
			outgoing.writeHead(typeof id === 'string' ? 404 : 400).end();
			return;
		}
		const request = new Request(`http://127.0.0.1${incoming.url ?? '/mcp'}`, {
			method: logged.method,
			headers: Object.entries(incoming.headers).flatMap(([name, value]) =>
				typeof value === 'string' ? [[name, value] as [string, string]] : []
			),
			...(logged.body && logged.method !== 'GET' && logged.method !== 'DELETE'
				? { body: logged.body }
				: {}),
		});
		const answered = await transport.handleRequest(
			request,
			parsed !== undefined ? { parsedBody: parsed } : undefined
		);
		const headers: Record<string, string> = {};
		answered.headers.forEach((value, name) => {
			headers[name] = value;
		});
		const issued = answered.headers.get('mcp-session-id');
		if (method === 'initialize' && issued)
			owners.set(
				issued,
				String(
					(parsed as { params?: { clientInfo?: { name?: unknown } } }).params?.clientInfo?.name
				)
			);
		outgoing.writeHead(answered.status, headers);
		if (!answered.body) return void outgoing.end();
		const reader = answered.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			outgoing.write(value);
		}
		outgoing.end();
	}, fixture);
	return Object.assign(fixture, {
		url,
		release() {
			releaseSlow?.();
		},
		openSessions: () => [...owners.values()],
		async close() {
			await Promise.all([...sessions.values()].map((transport) => transport.close()));
			await stop(server);
		},
	}) as Fixture & { release(): void; openSessions(): string[] };
}
