/**
 * @fileoverview Stdio builds no HTTP runtime (#1746): no session store, authorization layer,
 * `/mcp` lane, HTTP handler, SSE hub, or the HTTP routes' engine and router. Each builder is wrapped to count its calls, and an HTTP
 * server built from the same options is the control that proves the wrappers see every build.
 * Stdio still refuses the HTTP-only options an HTTP server would refuse.
 */
import { success } from '@lushly-dev/afd-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { McpAuthOptions } from './mcp-auth.js';
import { defineCommand } from './schema.js';
import { createMcpServer } from './server.js';
import type { McpServerOptions } from './server-types.js';

const built = vi.hoisted(() => ({
	sessionStore: 0,
	authLayer: 0,
	modernLane: 0,
	httpHandler: 0,
	sseHub: 0,
	routers: 0,
}));

vi.mock('./tool-router.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./tool-router.js')>();
	return {
		...actual,
		createToolRouter: (...args: Parameters<typeof actual.createToolRouter>) => {
			built.routers++;
			return actual.createToolRouter(...args);
		},
	};
});

vi.mock('./http-sessions.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./http-sessions.js')>();
	return {
		...actual,
		createSessionStore: (...args: Parameters<typeof actual.createSessionStore>) => {
			built.sessionStore++;
			return actual.createSessionStore(...args);
		},
	};
});
vi.mock('./mcp-auth.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./mcp-auth.js')>();
	return {
		...actual,
		createAuthLayer: (...args: Parameters<typeof actual.createAuthLayer>) => {
			built.authLayer++;
			return actual.createAuthLayer(...args);
		},
	};
});
vi.mock('./mcp-modern.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./mcp-modern.js')>();
	return {
		...actual,
		createModernHttpLane: (...args: Parameters<typeof actual.createModernHttpLane>) => {
			built.modernLane++;
			return actual.createModernHttpLane(...args);
		},
	};
});
vi.mock('./http-handler.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./http-handler.js')>();
	return {
		...actual,
		createHttpHandler: (...args: Parameters<typeof actual.createHttpHandler>) => {
			built.httpHandler++;
			return actual.createHttpHandler(...args);
		},
	};
});
vi.mock('./http-sse.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./http-sse.js')>();
	return {
		...actual,
		createSseHub: (...args: Parameters<typeof actual.createSseHub>) => {
			built.sseHub++;
			return actual.createSseHub(...args);
		},
	};
});

const RESOURCE = 'https://mcp.test.example/mcp';
const auth: McpAuthOptions = {
	resource: RESOURCE,
	authorizationServers: ['https://as.test.example'],
	verifier: { verify: async () => ({ ok: false, rule: 'signature' }) } as never,
};

/** Options that would build every HTTP piece: contexts (sessions) and `auth`. */
function options(transport: 'stdio' | 'http', extra: Partial<McpServerOptions> = {}) {
	return {
		name: 'stdio-runtime',
		version: '1.0.0',
		transport,
		host: '127.0.0.1',
		port: 0,
		contexts: [{ name: 'notes' }],
		auth,
		commands: [
			defineCommand({
				name: 'note-read',
				description: 'Read the notes',
				expose: { mcp: true },
				input: z.object({}),
				handler: async () => success({ notes: [] }),
			}),
		],
		...extra,
	} satisfies McpServerOptions;
}

beforeEach(() => {
	for (const key of Object.keys(built) as (keyof typeof built)[]) built[key] = 0;
});

describe('stdio builds no HTTP runtime (#1746)', () => {
	it('builds each HTTP piece once for HTTP', () => {
		const server = createMcpServer(options('http'));
		expect(server.getTransport()).toBe('http');
		expect(built).toEqual({
			sessionStore: 1,
			authLayer: 1,
			modernLane: 1,
			httpHandler: 1,
			sseHub: 1,
			// The MCP lanes' router, and the HTTP routes' own (with its engine).
			routers: 2,
		});
	});

	it('builds none of them for stdio', () => {
		const server = createMcpServer(options('stdio'));
		expect(server.getTransport()).toBe('stdio');
		expect(server.getUrl()).toBe('stdio://');
		expect(built).toEqual({
			sessionStore: 0,
			authLayer: 0,
			modernLane: 0,
			httpHandler: 0,
			sseHub: 0,
			// The MCP lanes' router only: the HTTP routes' engine and router are not built.
			routers: 1,
		});
	});

	it("refuses a body limit with the SDK's own error, which checkModernBodyLimit mirrors", async () => {
		const { createMcpHandler } = await import('@modelcontextprotocol/server');
		const { checkModernBodyLimit } = await import('./mcp-modern.js');
		for (const limit of [-1, 0, Number.NaN]) {
			let sdk: unknown;
			try {
				createMcpHandler(
					() => {
						throw new Error('unused');
					},
					{ maxRequestBodySize: limit }
				);
			} catch (error) {
				sdk = error;
			}
			expect(sdk, `the SDK accepts ${limit}`).toBeInstanceOf(Error);
			let ours: unknown;
			try {
				checkModernBodyLimit(limit);
			} catch (error) {
				ours = error;
			}
			expect((ours as Error | undefined)?.message).toBe((sdk as Error).message);
		}
	});

	it('builds, as before, a server whose context field JSON Schema cannot describe', () => {
		// Described at the first `/mcp` exchange or stdio connection, where it always was.
		const contextFields = [{ name: 'when', meta: 'com.example/when', schema: z.coerce.date() }];
		for (const transport of ['http', 'stdio'] as const) {
			expect(createMcpServer(options(transport, { contextFields })).getTransport()).toBe(transport);
		}
	});

	it('reads no SSE heartbeat option, as before', () => {
		// Not an option of the server: the hub keeps its default whatever an untyped caller passes.
		const extra = { sseHeartbeatMs: 0 } as Partial<McpServerOptions>;
		for (const transport of ['http', 'stdio'] as const) {
			expect(createMcpServer(options(transport, extra)).getTransport()).toBe(transport);
		}
	});

	it('still runs commands in process on stdio', async () => {
		const server = createMcpServer(options('stdio'));
		await expect(server.execute('note-read', {})).resolves.toMatchObject({
			success: true,
			data: { notes: [] },
		});
	});

	/** The message `createMcpServer` throws with these options over `transport`. */
	function refusal(transport: 'stdio' | 'http', extra: Partial<McpServerOptions>): string {
		try {
			createMcpServer(options(transport, extra));
		} catch (error) {
			return (error as Error).message;
		}
		throw new Error(`createMcpServer accepted ${JSON.stringify(extra)} over ${transport}`);
	}

	it.each<[string, Partial<McpServerOptions>, RegExp]>([
		['an SSE limit', { maxSseConnections: 0 }, /^maxSseConnections must be a positive integer$/],
		// The `/mcp` lane meets the body limit first, so HTTP has always answered with the SDK's
		// check; one the SDK accepts (not a whole number) meets the handler's.
		['a body limit', { maxBodyBytes: -1 }, /^maxRequestBodySize must be a positive number/],
		['a fractional body limit', { maxBodyBytes: 1.5 }, /^maxBodyBytes must be a positive integer$/],
		['an origin', { allowedOrigins: ['*'] }, /^allowedOrigins entry "\*"/],
		['a session timeout', { sessionIdleTimeoutMs: 0 }, /^sessionIdleTimeoutMs must be/],
		['a tools/list TTL', { toolsListTtlMs: -1 }, /^toolsListTtlMs must be a non-negative/],
		[
			'an auth option',
			{ auth: { ...auth, filterToolsByScope: 'yes' as never } },
			/auth\.filterToolsByScope must be a boolean$/,
		],
	])(
		'refuses %s on stdio as on HTTP, with the same error and nothing built',
		(_what, extra, message) => {
			const http = refusal('http', extra);
			expect(http).toMatch(message);
			expect(refusal('stdio', extra)).toBe(http);
			// No HTTP piece (the core's MCP router may come before the option that refuses).
			const { routers: _routers, ...httpPieces } = built;
			expect(Object.values(httpPieces).every((count) => count === 0)).toBe(true);
		}
	);
});
